/**
 * scripts/check-critical-activity-coverage.ts
 * ------------------------------------------------------------------
 * PRODUCTION-GATE POLICY ENFORCEMENT
 *
 * "Setiap fitur baru yang punya draft, upload, background job, atau
 *  mutation WAJIB mendaftarkan critical activity sebelum boleh masuk
 *  production."
 *
 * This scanner statically inspects `src/components/**` and `src/hooks/**`
 * for files that EXHIBIT a draft / upload / background-job / in-flight
 * mutation pattern, and verifies each such file (or its primary hook
 * import) contains a `useCriticalActivity` call.
 *
 * Files WITHOUT a matching `useCriticalActivity` call are reported as
 * VIOLATIONS. The script exits non-zero if any violation is not in the
 * allowlist (`scripts/critical-activity-allowlist.json`).
 *
 * Usage:
 *   bun run scripts/check-critical-activity-coverage.ts            # scan
 *   bun run scripts/check-critical-activity-coverage.ts --update   # rewrite allowlist with current findings (use to bootstrap)
 *
 * Exit codes:
 *   0 — all violations are allowlisted (or no violations found)
 *   1 — unallowlisted violations present (BLOCKS merge)
 *   2 — scanner error (bad allowlist, IO failure, etc.)
 *
 * Heuristics (intentionally conservative — false positives belong in
 * the allowlist with a documented reason):
 *
 *   PATTERN_DRAFT      — `isDirty`, `formState.isDirty`, `hasChanges`,
 *                        `useState<…Draft>`, `draft`, `setDraft`
 *   PATTERN_UPLOAD     — `<input type="file">`, `FormData`, `FileReader`,
 *                        `XLSX.read`, `readAsArrayBuffer`, `readAsText`,
 *                        `xlsx` import + `parse`/`read` call
 *   PATTERN_BG_JOB     — `Worker(`, `new SharedWorker`, `postMessage`
 *                        to a worker, `dedicatedWorker`, `useWorker`
 *   PATTERN_INFLIGHT   — state vars named `submitting|saving|deleting|
 *                        adjusting|creating|voidSubmitting|processing|
 *                        isLoading` paired with a `fetch(`/api/…`,
 *                        {method:'POST'|'PUT'|'DELETE'|'PATCH'})` or
 *                        `axios.post/put/delete/patch` or `mutate(`
 *                        (react-hook-form / TanStack mutate).
 *
 *   A file matches a pattern if ANY of its indicators appear.
 *   A file is considered "covered" if the file itself, OR the hook
 *   file it imports via `useXxx` from `@/hooks/use-xxx`, contains a
 *   `useCriticalActivity(` call.
 *
 * Limitations (documented, not blocking):
 *   - The scanner does NOT verify the boolean trigger flag is correct.
 *     A reviewer must still confirm `active={isActuallySubmitting}`.
 *   - The scanner does NOT verify the severity tier. A reviewer must
 *     still confirm `in-flight` for payment/mutation, `data-loss` for
 *     drafts, `interrupt` for resumable background work.
 *   - These reviewer concerns are covered by the PR checklist in
 *     docs/BUILD-GUARD-V1-LOCK.md §0.
 *
 * Reference: docs/BUILD-GUARD-V1-LOCK.md §0 (Production-Gate Policy)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const SCAN_ROOTS = ['src/components', 'src/hooks']
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'critical-activity-allowlist.json')

interface Violation {
  file: string
  patterns: string[]
  indicators: string[]
  reason: string
}

interface AllowlistEntry {
  file: string
  reason: string
}

// ── Pattern definitions ─────────────────────────────────────────────────────

interface Pattern {
  name: string
  // matches any of these regexes against file content
  indicators: RegExp[]
  // human-readable description of what this pattern detects
  description: string
}

const PATTERNS: Pattern[] = [
  {
    name: 'DRAFT',
    description: 'unsaved form state / draft buffer',
    indicators: [
      /\bisDirty\b/,
      /formState\.isDirty/,
      /\bhasChanges\b/,
      /\bdraft[A-Z][a-zA-Z]*\s*[:=]/, // `draft:` `draft=`
      /\bsetDraft\b/,
      /\buseState<[^>]*Draft/,
    ],
  },
  {
    name: 'UPLOAD',
    description: 'file upload / Excel parse / file export',
    indicators: [
      /type=['"]file['"]/,
      /\bFormData\b/,
      /\bFileReader\b/,
      /\breadAsArrayBuffer\b/,
      /\breadAsText\b/,
      /\bXLSX\.read\b/,
      /\bXLSX\.write\b/,
      /from\s+['"]xlsx['"]/,
      /\bwriteFile\s*\(\s*[^)]*\.xlsx/,
    ],
  },
  {
    name: 'BG_JOB',
    description: 'background worker / queue',
    indicators: [
      /\bnew\s+Worker\b/,
      /\bnew\s+SharedWorker\b/,
      /\bpostMessage\s*\(/,
      /\buseWorker\b/,
      /\bdedicatedWorker\b/,
    ],
  },
  {
    name: 'INFLIGHT_MUTATION',
    description: 'in-flight API mutation (POST/PUT/DELETE/PATCH) with submitting state',
    indicators: [
      // fetch with mutation method
      /fetch\s*\(\s*[^)]*['"][^'"]*['"][^)]*method\s*:\s*['"](POST|PUT|DELETE|PATCH)['"]/,
      // axios mutation
      /\baxios\.(post|put|delete|patch)\s*\(/,
      // TanStack mutate / useMutation
      /\buseMutation\b/,
      /\bmutate(Async)?\s*\(/,
      // common in-flight state var names paired with api path
      /\b(voidSubmitting|isSubmitting|isSaving|isDeleting|isAdjusting|isCreating|isProcessing|poCreateLoading|poEditLoading|deletingPo|invActionLoading|actionLoading)\b/,
    ],
  },
]

// ── File walker ─────────────────────────────────────────────────────────────

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(full, acc)
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
      acc.push(full)
    }
  }
  return acc
}

// ── Hook-import resolution ──────────────────────────────────────────────────
//
// If `file` imports `useXxx` from `@/hooks/use-xxx`, return the resolved
// hook file path so we can check whether the hook (rather than the
// component) registers the activity. This is how `use-pos-cart.ts`
// (hook) registers `pos-cart` for `pos-page.tsx` (component).

function resolveHookImports(file: string, content: string): string[] {
  const hookFiles: string[] = []
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]@\/hooks\/([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = importRegex.exec(content)) !== null) {
    const specifiers = m[1].split(',').map((s) => s.trim())
    const hookPath = m[2]
    // Only follow `useXxx` imports (skip `useToast`, `useRouter` etc. that
    // live in hooks/ but aren't activity-bearing). We resolve the file
    // regardless and let the consumer decide — over-filtration here would
    // hide real coverage.
    if (!specifiers.some((s) => /^use[A-Z]/.test(s))) continue
    const resolved = path.join(ROOT, 'src', 'hooks', `${hookPath}.ts`)
    const resolvedTsx = path.join(ROOT, 'src', 'hooks', `${hookPath}.tsx`)
    if (fs.existsSync(resolved)) hookFiles.push(resolved)
    else if (fs.existsSync(resolvedTsx)) hookFiles.push(resolvedTsx)
  }
  return hookFiles
}

function hasUseCriticalActivity(content: string): boolean {
  // Match the call, not the import or comment
  return /\buseCriticalActivity\s*\(/.test(content)
}

// ── Scanner ────────────────────────────────────────────────────────────────

function scan(): Violation[] {
  const allFiles = new Set<string>()
  for (const root of SCAN_ROOTS) {
    const full = path.join(ROOT, root)
    for (const f of walk(full)) allFiles.add(f)
  }

  const violations: Violation[] = []

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8')

    // Skip the hook definition file itself
    if (file.endsWith(path.join('hooks', 'use-critical-activity.ts'))) continue

    const matchedPatterns: string[] = []
    const matchedIndicators: string[] = []
    for (const p of PATTERNS) {
      for (const re of p.indicators) {
        if (re.test(content)) {
          if (!matchedPatterns.includes(p.name)) matchedPatterns.push(p.name)
          matchedIndicators.push(`${p.name}:/${re.source}/`)
          break // one indicator per pattern is enough
        }
      }
    }
    if (matchedPatterns.length === 0) continue

    // Is this file covered — either directly or via a hook it imports?
    let covered = hasUseCriticalActivity(content)
    if (!covered) {
      const hookFiles = resolveHookImports(file, content)
      for (const hf of hookFiles) {
        try {
          const hookContent = fs.readFileSync(hf, 'utf8')
          if (hasUseCriticalActivity(hookContent)) {
            covered = true
            break
          }
        } catch {
          /* hook file missing — skip */
        }
      }
    }

    if (!covered) {
      const rel = path.relative(ROOT, file)
      violations.push({
        file: rel,
        patterns: matchedPatterns,
        indicators: matchedIndicators,
        reason: `exhibits ${matchedPatterns.join(' + ')} pattern but no useCriticalActivity call in file or imported hooks`,
      })
    }
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file))
}

// ── Allowlist ───────────────────────────────────────────────────────────────

function loadAllowlist(): AllowlistEntry[] {
  try {
    const raw = fs.readFileSync(ALLOWLIST_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    // Accept either a bare array (legacy) or an object with `entries` (current).
    const arr: unknown = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.entries)
        ? parsed.entries
        : null
    if (!Array.isArray(arr)) {
      throw new Error('allowlist must be a JSON array or an object with an `entries` array')
    }
    return arr as AllowlistEntry[]
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    console.error(`✗ allowlist parse error: ${(e as Error).message}`)
    process.exit(2)
  }
}

function saveAllowlist(entries: AllowlistEntry[]): void {
  // Preserve the object shape (version + description + entries) on rewrite.
  const json =
    JSON.stringify(
      {
        version: 1,
        description:
          'False-positive allowlist for the Critical Activity Coverage Scanner. Each entry MUST have a documented reason. Three categories: (1) TRANSITIVE — the activity is registered by a parent hook/provider that this file consumes; (2) INFRA — this file IS the build-guard infrastructure and cannot register an activity on itself; (3) READ-WITH-SIDE-EFFECT — the POST is an idempotent auto-triggered refresh, not a user-initiated mutation. Reviewer MUST re-validate entries when the referenced transitive provider changes.',
        entries,
      },
      null,
      2,
    ) + '\n'
  fs.writeFileSync(ALLOWLIST_PATH, json, 'utf8')
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2)
  const updateMode = args.includes('--update')

  const violations = scan()
  const allowlist = loadAllowlist()
  const allowlistFiles = new Set(allowlist.map((e) => e.file))

  if (updateMode) {
    // Bootstrap mode: write current findings to allowlist with placeholder reason.
    // Reviewer MUST edit reasons before merging.
    const next: AllowlistEntry[] = violations.map((v) => ({
      file: v.file,
      reason: `TODO: document why this file is allowlisted (patterns: ${v.patterns.join(', ')})`,
    }))
    saveAllowlist(next)
    console.log(
      `✓ allowlist rewritten with ${next.length} entries. Review and edit reasons in scripts/critical-activity-allowlist.json before committing.`,
    )
    process.exit(0)
  }

  // Report
  console.log('━' .repeat(72))
  console.log('Aether Critical Activity Coverage Scanner — V1 policy gate')
  console.log('━' .repeat(72))
  console.log(`Scanned roots:     ${SCAN_ROOTS.join(', ')}`)
  console.log(`Patterns checked:  ${PATTERNS.map((p) => p.name).join(', ')}`)
  console.log(`Findings:          ${violations.length}`)
  console.log(`Allowlisted:       ${allowlist.length}`)
  console.log('')

  const unallowlisted = violations.filter((v) => !allowlistFiles.has(v.file))

  if (violations.length > 0) {
    console.log('Findings:')
    for (const v of violations) {
      const tag = allowlistFiles.has(v.file) ? '[allowlisted]' : '[VIOLATION]'
      console.log(`  ${tag} ${v.file}`)
      console.log(`           patterns:   ${v.patterns.join(', ')}`)
      console.log(`           indicators: ${v.indicators.join(', ')}`)
      const allowed = allowlist.find((a) => a.file === v.file)
      if (allowed) {
        console.log(`           reason:     ${allowed.reason}`)
      }
    }
    console.log('')
  }

  // Detect stale allowlist entries (files no longer flagged, or no longer existing)
  const violationFiles = new Set(violations.map((v) => v.file))
  const stale = allowlist.filter((e) => !violationFiles.has(e.file))
  if (stale.length > 0) {
    console.log('Stale allowlist entries (file no longer flagged — please remove):')
    for (const s of stale) {
      console.log(`  ${s.file}`)
      console.log(`    reason: ${s.reason}`)
    }
    console.log('')
  }

  // Final verdict
  if (unallowlisted.length === 0) {
    console.log('✓ PASS — all findings are allowlisted.')
    if (stale.length > 0) {
      console.log(
        `  Note: ${stale.length} stale allowlist entr${stale.length === 1 ? 'y' : 'ies'} should be cleaned up (non-blocking).`,
      )
    }
    process.exit(0)
  } else {
    console.log(`✗ FAIL — ${unallowlisted.length} unallowlisted violation(s):`)
    for (const v of unallowlisted) {
      console.log(`  ${v.file}`)
      console.log(`    ${v.reason}`)
    }
    console.log('')
    console.log(
      'To fix: add a `useCriticalActivity(...)` call to the file (or its primary hook) per docs/BUILD-GUARD-V1-LOCK.md §7.',
    )
    console.log(
      'If this is a true false-positive (read-only view, no real in-flight window), add an entry to scripts/critical-activity-allowlist.json with a reason.',
    )
    process.exit(1)
  }
}

main()
