import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * GET /api/build-version
 *
 * Returns the current deployment's build ID (Next.js buildId) + git commit
 * (if available) + timestamp. Used by the Service Worker registration hook
 * (`use-service-worker.ts`) as the canonical server-buildId source — replacing
 * the old HTML-parse approach which could read a STALE cached HTML document.
 *
 * Cache policy (CRITICAL):
 *   Cache-Control: no-store, max-age=0, must-revalidate
 *
 * This endpoint MUST NEVER be cached by:
 *   - the browser (no-store)
 *   - the Service Worker (the SW fetch handler bypasses /api/build-version)
 *   - Vercel's edge cache (no-store + the route is dynamic)
 *
 * The Service Worker's fetch handler explicitly skips /api/build-version so
 * the request always hits the network origin. The browser is forced to
 * re-validate via the no-store directive.
 *
 * Public + unauthenticated: this endpoint reveals only a build identifier
 * (already present in chunk URLs /__NEXT_DATA__) — no business data.
 */

// Always dynamic — never static, never cached at the edge.
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Cache the buildId in module scope (it never changes for the lifetime of
// the server process — a new deploy spawns a new process).
let cachedBuildId: string | null = null

async function getBuildId(): Promise<string> {
  if (cachedBuildId) return cachedBuildId
  // 1. Vercel env var (set at build time if configured)
  if (process.env.NEXT_PUBLIC_BUILD_ID) {
    cachedBuildId = process.env.NEXT_PUBLIC_BUILD_ID
    return cachedBuildId
  }
  // 2. Read from .next/BUILD_ID (Next.js writes this at build time)
  try {
    const buildIdPath = path.join(process.cwd(), '.next', 'BUILD_ID')
    const buildId = (await readFile(buildIdPath, 'utf8')).trim()
    if (buildId) {
      cachedBuildId = buildId
      return buildId
    }
  } catch {
    // .next/BUILD_ID not available (dev mode or not built yet) — fall through
  }
  // 3. Dev mode fallback
  cachedBuildId = 'development'
  return cachedBuildId
}

export async function GET() {
  const buildId = await getBuildId()
  return NextResponse.json(
    {
      buildId,
      // Vercel exposes the git commit sha via env var at build time
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      // Server timestamp so the client can detect clock skew / stale responses
      timestamp: Date.now(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    },
  )
}
