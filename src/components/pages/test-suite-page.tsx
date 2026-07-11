'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Play,
  PlayCircle,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Timer,
  ListChecks,
  Shield,
  FlaskConical,
  ArrowDownUp,
  Users,
  FileText,
  Package,
  ShoppingCart,
  Zap,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

interface ScenarioInfo {
  id: string
  priority?: string
  category: string
  name: string
  description: string
}

interface TestStep {
  step: string
  status: 'PASS' | 'FAIL' | 'SKIP' | 'ERROR'
  detail?: string
  error?: string
}

interface ScenarioResult {
  id: string
  category: string
  name: string
  description: string
  status: 'PASS' | 'FAIL' | 'ERROR' | 'RUNNING'
  steps: TestStep[]
  durationMs: number
  error?: string
}

// ════════════════════════════════════════════════════════════
// Category Config
// ════════════════════════════════════════════════════════════

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  Inventory: { label: 'Inventory', icon: <Package className="h-4 w-4" />, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  Transaction: { label: 'Transaction', icon: <ShoppingCart className="h-4 w-4" />, color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  Purchase: { label: 'Purchase', icon: <FileText className="h-4 w-4" />, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  Transfer: { label: 'Transfer', icon: <ArrowDownUp className="h-4 w-4" />, color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/20' },
  Customer: { label: 'Customer', icon: <Users className="h-4 w-4" />, color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/20' },
  Audit: { label: 'Audit', icon: <Shield className="h-4 w-4" />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  'Relational Audit': { label: 'Audit Relasi', icon: <Activity className="h-4 w-4" />, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  BATCH: { label: 'BATCH', icon: <Package className="h-4 w-4" />, color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
  DEXIE: { label: 'DEXIE', icon: <Package className="h-4 w-4" />, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  STOCK: { label: 'STOCK', icon: <Package className="h-4 w-4" />, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  HPP: { label: 'HPP', icon: <FileText className="h-4 w-4" />, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  UI: { label: 'UI', icon: <Zap className="h-4 w-4" />, color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
  'Health Check': { label: 'INVARIANT', icon: <Activity className="h-4 w-4" />, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  CRITICAL: { label: '🔴 Critical', color: 'text-rose-400', bg: 'bg-rose-500/10' },
  MEDIUM: { label: '🟡 Medium', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  LOW: { label: '🟢 Low', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  INVARIANT: { label: '🔥 Invariant', color: 'text-red-400', bg: 'bg-red-500/10' },
  ORIGINAL: { label: '📦 Original', color: 'text-slate-400', bg: 'bg-slate-500/10' },
}

const STATUS_STYLES: Record<string, { icon: React.ReactNode; color: string; bg: string; border: string; label: string }> = {
  PENDING: { icon: <ListChecks className="h-3.5 w-3.5" />, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20', label: 'Pending' },
  RUNNING: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', label: 'Running' },
  PASS: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Pass' },
  FAIL: { icon: <XCircle className="h-3.5 w-3.5" />, color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20', label: 'Fail' },
  ERROR: { icon: <AlertCircle className="h-3.5 w-3.5" />, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Error' },
}

// ════════════════════════════════════════════════════════════
// Page Component (wrapper — role guard)
// ════════════════════════════════════════════════════════════

export default function TestSuitePage() {
  const { data: session, status: sessionStatus } = useSession()

  if (sessionStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    )
  }
  if (!session || session.user?.role !== 'OWNER') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Shield className="h-10 w-10 text-slate-600" />
        <p className="text-sm text-slate-400 font-medium">Akses ditolak</p>
        <p className="text-xs text-slate-600">Modul ini hanya untuk Owner / Webmaster.</p>
      </div>
    )
  }

  return <TestSuiteContent />
}

// ════════════════════════════════════════════════════════════
// Test Suite Content (all hooks live here)
// ════════════════════════════════════════════════════════════

function TestSuiteContent() {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([])
  const [results, setResults] = useState<Record<string, ScenarioResult>>({})
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | 'all' | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filterCat, setFilterCat] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string | null>(null)
  const [filterPriority, setFilterPriority] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load scenario list
  useEffect(() => {
    fetch('/api/test-suite')
      .then((r) => r.json())
      .then((data) => {
        if (data.scenarios) setScenarios(data.scenarios)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Toggle step expansion
  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Run single scenario
  const runSingle = useCallback(async (id: string) => {
    setRunning(id)
    setResults((prev) => ({
      ...prev,
      [id]: { id, category: '', name: '', description: '', status: 'RUNNING', steps: [], durationMs: 0 },
    }))
    try {
      const res = await fetch('/api/test-suite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: id }),
      })
      const data = await res.json()
      if (data.result) {
        setResults((prev) => ({ ...prev, [id]: data.result }))
        setExpanded((prev) => {
          const next = new Set(prev)
          if (data.result.status !== 'PASS') next.add(id)
          return next
        })
      } else {
        setResults((prev) => ({
          ...prev,
          [id]: { id, category: '', name: id, description: '', status: 'ERROR', steps: [], durationMs: 0, error: data.error || 'Unknown error' },
        }))
      }
    } catch {
      setResults((prev) => ({
        ...prev,
        [id]: { id, category: '', name: id, description: '', status: 'ERROR', steps: [], durationMs: 0, error: 'Network error' },
      }))
    } finally {
      setRunning(null)
    }
  }, [])

  // Run all scenarios
  const runAll = useCallback(async () => {
    setRunning('all')
    try {
      const res = await fetch('/api/test-suite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runAll: true }),
      })
      const data = await res.json()
      if (data.results) {
        const map: Record<string, ScenarioResult> = {}
        for (const r of data.results) map[r.id] = r
        setResults(map)
        // Auto-expand failures
        setExpanded(() => {
          const s = new Set<string>()
          for (const r of data.results) {
            if (r.status !== 'PASS') s.add(r.id)
          }
          return s
        })
      }
    } catch {
      // silent
    } finally {
      setRunning(null)
    }
  }, [])

  // Computed stats
  const totalScenarios = scenarios.length
  const completedResults = Object.values(results)
  const passCount = completedResults.filter((r) => r.status === 'PASS').length
  const failCount = completedResults.filter((r) => r.status === 'FAIL').length
  const errorCount = completedResults.filter((r) => r.status === 'ERROR').length
  const passRate = completedResults.length > 0 ? Math.round((passCount / completedResults.length) * 100) : 0

  // Group by category
  const categories = [...new Set(scenarios.map((s) => s.category))]

  // Filter
  const filtered = scenarios.filter((s) => {
    if (filterPriority && (s.priority || 'ORIGINAL') !== filterPriority) return false
    if (filterCat && s.category !== filterCat) return false
    if (filterStatus) {
      const r = results[s.id]
      const rStatus = r?.status || 'PENDING'
      if (filterStatus !== rStatus) return false
    }
    return true
  })

  // Run by priority
  const runByPriority = useCallback(async (priority: string) => {
    setRunning('all')
    try {
      const res = await fetch('/api/test-suite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority }),
      })
      const data = await res.json()
      if (data.results) {
        const map: Record<string, ScenarioResult> = { ...results }
        for (const r of data.results) map[r.id] = r
        setResults(map)
        setExpanded(() => {
          const s = new Set<string>()
          for (const r of data.results) { if (r.status !== 'PASS' && r.status !== 'SKIP') s.add(r.id) }
          return s
        })
      }
    } catch { /* silent */ } finally { setRunning(null) }
  }, [results])

  // ── Render ──

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <FlaskConical className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Business Scenario Test Suite</h1>
              <p className="text-xs text-slate-500 mt-0.5">AetherPOS — {totalScenarios} scenarios across {categories.length} categories</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={runAll}
              disabled={running !== null || loading}
              className="border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
            >
              {running === 'all' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5 mr-1.5" />
              )}
              {running === 'all' ? 'Running...' : 'Run All'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setResults({}); setExpanded(new Set()) }}
              className="text-slate-500 hover:text-slate-300"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Reset
            </Button>
          </div>
        </div>

        {/* Summary Bar */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6"
        >
          <SummaryCard label="Total" value={totalScenarios} color="text-white" bg="bg-white/5" icon={<ListChecks className="h-4 w-4 text-slate-400" />} />
          <SummaryCard label="Passed" value={passCount} color="text-emerald-400" bg="bg-emerald-500/10" icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />} />
          <SummaryCard label="Failed" value={failCount} color="text-rose-400" bg="bg-rose-500/10" icon={<XCircle className="h-4 w-4 text-rose-400" />} />
          <SummaryCard label="Error" value={errorCount} color="text-amber-400" bg="bg-amber-500/10" icon={<AlertCircle className="h-4 w-4 text-amber-400" />} />
          <SummaryCard
            label="Pass Rate"
            value={`${passRate}%`}
            color={passRate >= 80 ? 'text-emerald-400' : passRate >= 50 ? 'text-amber-400' : 'text-rose-400'}
            bg={passRate >= 80 ? 'bg-emerald-500/10' : passRate >= 50 ? 'bg-amber-500/10' : 'bg-rose-500/10'}
            icon={<Activity className="h-4 w-4" />}
          />
        </motion.div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-5">
          {/* Priority filters */}
          <FilterPill active={filterPriority === null} onClick={() => setFilterPriority(null)}>All ({scenarios.length})</FilterPill>
          <FilterPill active={filterPriority === 'CRITICAL'} onClick={() => setFilterPriority(filterPriority === 'CRITICAL' ? null : 'CRITICAL')}>
            <span className="mr-1">🔴</span>Critical ({scenarios.filter(s => s.priority === 'CRITICAL').length})
          </FilterPill>
          <FilterPill active={filterPriority === 'MEDIUM'} onClick={() => setFilterPriority(filterPriority === 'MEDIUM' ? null : 'MEDIUM')}>
            <span className="mr-1">🟡</span>Medium ({scenarios.filter(s => s.priority === 'MEDIUM').length})
          </FilterPill>
          <FilterPill active={filterPriority === 'LOW'} onClick={() => setFilterPriority(filterPriority === 'LOW' ? null : 'LOW')}>
            <span className="mr-1">🟢</span>Low ({scenarios.filter(s => s.priority === 'LOW').length})
          </FilterPill>
          <FilterPill active={filterPriority === 'INVARIANT'} onClick={() => setFilterPriority(filterPriority === 'INVARIANT' ? null : 'INVARIANT')}>
            <span className="mr-1">🔥</span>Invariant ({scenarios.filter(s => s.priority === 'INVARIANT').length})
          </FilterPill>
          <span className="w-px h-6 bg-slate-700/50 mx-1 self-center" />
          <FilterPill active={filterCat === null} onClick={() => setFilterCat(null)}>All Categories</FilterPill>
          {categories.map((cat) => {
            const cfg = CATEGORY_CONFIG[cat]
            return (
              <FilterPill key={cat} active={filterCat === cat} onClick={() => setFilterCat(filterCat === cat ? null : cat)}>
                {cfg?.label || cat}
              </FilterPill>
            )
          })}
          <span className="w-px h-6 bg-slate-700/50 mx-1 self-center" />
          <FilterPill active={filterStatus === null} onClick={() => setFilterStatus(null)}>All Status</FilterPill>
          <FilterPill active={filterStatus === 'PASS'} onClick={() => setFilterStatus(filterStatus === 'PASS' ? null : 'PASS')}>
            <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-400" />Pass
          </FilterPill>
          <FilterPill active={filterStatus === 'FAIL'} onClick={() => setFilterStatus(filterStatus === 'FAIL' ? null : 'FAIL')}>
            <XCircle className="h-3 w-3 mr-1 text-rose-400" />Fail
          </FilterPill>
          <FilterPill active={filterStatus === 'ERROR'} onClick={() => setFilterStatus(filterStatus === 'ERROR' ? null : 'ERROR')}>
            <AlertCircle className="h-3 w-3 mr-1 text-amber-400" />Error
          </FilterPill>
          <FilterPill active={filterStatus === 'PENDING'} onClick={() => setFilterStatus(filterStatus === 'PENDING' ? null : 'PENDING')}>
            <ListChecks className="h-3 w-3 mr-1 text-slate-400" />Pending
          </FilterPill>
        </div>

        {/* Scenario List */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 bg-white/[0.03] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-3" ref={scrollRef}>
            {filtered.map((scenario, idx) => {
              const result = results[scenario.id]
              const status = result?.status || 'PENDING'
              const statusStyle = STATUS_STYLES[status] || STATUS_STYLES.PENDING
              const catConfig = CATEGORY_CONFIG[scenario.category] || CATEGORY_CONFIG.Audit
              const isExpanded = expanded.has(scenario.id)
              const isRunning = running === scenario.id

              return (
                <motion.div
                  key={scenario.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.02 }}
                >
                  <Card
                    className={cn(
                      'border rounded-xl transition-all cursor-pointer hover:border-white/10',
                      status === 'PASS' && 'border-emerald-500/20 bg-emerald-500/[0.02]',
                      status === 'FAIL' && 'border-rose-500/20 bg-rose-500/[0.02]',
                      status === 'ERROR' && 'border-amber-500/20 bg-amber-500/[0.02]',
                      status === 'RUNNING' && 'border-blue-500/20 bg-blue-500/[0.02]',
                      status === 'PENDING' && 'border-white/5 bg-white/[0.01]'
                    )}
                    onClick={() => toggleExpand(scenario.id)}
                  >
                    <CardContent className="p-3 md:p-4">
                      <div className="flex items-center gap-3">
                        {/* Status icon */}
                        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', statusStyle.bg)}>
                          {statusStyle.icon}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-mono text-slate-600">{scenario.id}</span>
                            {scenario.priority && scenario.priority !== 'ORIGINAL' && (
                              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-medium', PRIORITY_CONFIG[scenario.priority]?.bg, PRIORITY_CONFIG[scenario.priority]?.color)}>
                                {PRIORITY_CONFIG[scenario.priority]?.label}
                              </span>
                            )}
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-medium', catConfig.bg, catConfig.color, 'border', catConfig.border)}>
                              {catConfig.label}
                            </span>
                          </div>
                          <h3 className="text-sm font-semibold text-white mt-0.5 truncate">{scenario.name}</h3>
                          <p className="text-[11px] text-slate-500 truncate">{scenario.description}</p>
                        </div>

                        {/* Right side */}
                        <div className="flex items-center gap-2 shrink-0">
                          {result && (
                            <span className="text-[10px] text-slate-600 flex items-center gap-1">
                              <Timer className="h-3 w-3" />
                              {result.durationMs > 1000 ? `${(result.durationMs / 1000).toFixed(1)}s` : `${result.durationMs}ms`}
                            </span>
                          )}
                          <Badge
                            variant="outline"
                            className={cn('text-[10px] px-2 py-0.5', statusStyle.color, statusStyle.border, 'border bg-transparent')}
                          >
                            {statusStyle.label}
                          </Badge>
                          {!isExpanded && result && result.steps.length > 0 && (
                            <span className="text-[10px] text-slate-600">
                              {result.steps.filter((s) => s.status === 'PASS').length}/{result.steps.length}
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-slate-500 hover:text-white"
                            onClick={(e) => {
                              e.stopPropagation()
                              runSingle(scenario.id)
                            }}
                            disabled={isRunning || running === 'all'}
                          >
                            {isRunning ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <PlayCircle className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-slate-600" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-600" />
                          )}
                        </div>
                      </div>

                      {/* Expanded steps */}
                      <AnimatePresence>
                        {isExpanded && result && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 ml-11 space-y-1.5 max-h-80 overflow-y-auto pr-2">
                              {result.steps.map((step, si) => {
                                const stepStyle = STATUS_STEPS[step.status]
                                return (
                                  <div key={si} className="flex items-start gap-2 py-1">
                                    <div className={cn('mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0 text-[10px]', stepStyle.bg, stepStyle.color)}>
                                      {stepStyle.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <span className="text-xs text-slate-300">{step.step}</span>
                                      {step.detail && (
                                        <p className="text-[10px] text-slate-600 mt-0.5 truncate">{step.detail}</p>
                                      )}
                                      {step.error && (
                                        <p className="text-[10px] text-rose-400 mt-0.5 break-all">{step.error}</p>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                              {result.error && (
                                <div className="mt-2 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
                                  <p className="text-[11px] text-rose-400 font-medium">Error</p>
                                  <p className="text-[10px] text-rose-400/80 break-all mt-0.5">{result.error}</p>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}

            {filtered.length === 0 && !loading && (
              <div className="py-12 text-center">
                <FlaskConical className="h-8 w-8 text-slate-700 mx-auto mb-2" />
                <p className="text-sm text-slate-600">No scenarios match the filter</p>
              </div>
            )}
          </div>
        )}

        {/* Progress bar for run-all */}
        {running === 'all' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50"
          >
            <Card className="border-blue-500/20 bg-[#0d1220] px-4 py-3 shadow-2xl">
              <div className="flex items-center gap-3">
                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                <span className="text-sm text-blue-400 font-medium">Running all {totalScenarios} scenarios...</span>
              </div>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Sub-components
// ════════════════════════════════════════════════════════════

const STATUS_STEPS: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  PASS: { icon: <CheckCircle2 className="h-3 w-3" />, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  FAIL: { icon: <XCircle className="h-3 w-3" />, color: 'text-rose-400', bg: 'bg-rose-500/10' },
  SKIP: { icon: <ListChecks className="h-3 w-3" />, color: 'text-slate-500', bg: 'bg-slate-500/10' },
  ERROR: { icon: <AlertCircle className="h-3 w-3" />, color: 'text-amber-400', bg: 'bg-amber-500/10' },
}

function SummaryCard({ label, value, color, bg, icon }: { label: string; value: string | number; color: string; bg: string; icon: React.ReactNode }) {
  return (
    <Card className="border border-white/5 bg-white/[0.02] rounded-xl">
      <CardContent className="p-3 flex items-center gap-2.5">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', bg)}>
          {icon}
        </div>
        <div>
          <p className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</p>
          <p className={cn('text-lg font-bold leading-tight', color)}>{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function FilterPill({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all',
        active
          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
          : 'bg-white/[0.03] text-slate-500 border border-transparent hover:bg-white/[0.06] hover:text-slate-300'
      )}
    >
      {children}
    </button>
  )
}