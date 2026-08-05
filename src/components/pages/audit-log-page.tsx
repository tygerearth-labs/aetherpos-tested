'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { formatDate, formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
} from '@/components/ui/responsive-dialog'
import { Separator } from '@/components/ui/separator'
import { Pagination } from '@/components/shared/pagination'
import { ProGate } from '@/components/shared/pro-gate'
import { DateFilter } from '@/components/shared/date-filter'
import { useIsMobile } from '@/hooks/use-mobile'
import { MobileFullScreenSheet } from '@/components/mobile/mobile-fullscreen-sheet'
import { MobileResultList, type MobileResultColumn } from '@/components/mobile/mobile-result-list'
import {
  Search,
  Download,
  X,
  RotateCcw,
  Loader2,
  Package,
  ShoppingCart,
  Boxes,
  Users,
  Layers,
  History,
  Tag,
} from 'lucide-react'

// ==================== TYPES ====================
type EventType =
  | 'MIGRATION_BATCH'
  | 'BULK_BATCH'
  | 'SALE'
  | 'VOID'
  | 'PURCHASE'
  | 'INVENTORY_ADJUSTMENT'
  | 'COMPOSITION_UPDATE'
  | 'CUSTOMER_CHANGE'
  | 'PRODUCT_CHANGE'
  | 'INVENTORY_ITEM_CHANGE'
  // v2.3 — entity-specific change events
  | 'PRODUCT_CATEGORY_CHANGE'
  | 'INVENTORY_CATEGORY_CHANGE'
  | 'SUPPLIER_CHANGE'
  | 'CREW_CHANGE'
  | 'PROMO_CHANGE'
  | 'OUTLET_CHANGE'
  | 'LEGACY'
  | null

interface AuditLog {
  id: string
  // V1 (legacy, may be present)
  action: string
  entityType: string
  entityId: string | null
  details: string | null
  // V2 event-oriented
  eventType: EventType
  title: string | null
  summary: string | null
  sections: string | null
  metadata: string | null
  operationId: string | null
  sourceEntityType: string | null
  sourceEntityId: string | null
  createdAt: string
  user: { name: string; email: string }
}

interface AuditField {
  k: string
  v: string
}

type AuditSectionType = 'summary' | 'changes' | 'inventory' | 'errors' | 'warnings' | 'skipped' | 'metadata'
type AuditSectionTone = 'default' | 'info' | 'success' | 'warning' | 'danger'

interface AuditSection {
  type: AuditSectionType
  label: string
  tone?: AuditSectionTone
  fields?: AuditField[]
  items?: Record<string, string>[]
  collapsed?: boolean
  columns?: string[]
  download?: {
    filename: string
    contentType: string
    data: string
    encoding?: 'text' | 'base64'
  }
}

interface AuditLogListResponse {
  logs: AuditLog[]
  total: number
  totalPages: number
}

// ==================== CONSTANTS ====================
const PAGE_SIZE = 20

/**
 * Grouped tabs — 18 raw event types collapsed into 7 business-domain groups.
 *
 * Each tab carries the list of `eventType`s it covers. The API accepts a
 * comma-separated `eventType` query (e.g. `eventType=SALE,VOID`) and runs a
 * single Prisma `in` query — so one tab = one DB filter, no client-side
 * filtering. The `ALL` group has an empty list and skips the filter entirely.
 */
const EVENT_GROUP_TABS: {
  value: string
  label: string
  icon: React.ElementType
  eventTypes: string[]
}[] = [
  { value: 'ALL', label: 'Semua', icon: History, eventTypes: [] },
  { value: 'SALES', label: 'Penjualan', icon: ShoppingCart, eventTypes: ['SALE', 'VOID'] },
  { value: 'STOCK', label: 'Stok & Pembelian', icon: Boxes, eventTypes: ['PURCHASE', 'INVENTORY_ADJUSTMENT'] },
  { value: 'PRODUCT', label: 'Produk & Item', icon: Tag, eventTypes: ['PRODUCT_CHANGE', 'PRODUCT_CATEGORY_CHANGE', 'INVENTORY_ITEM_CHANGE', 'INVENTORY_CATEGORY_CHANGE', 'COMPOSITION_UPDATE'] },
  { value: 'MASTER', label: 'Master Data', icon: Users, eventTypes: ['CUSTOMER_CHANGE', 'SUPPLIER_CHANGE', 'CREW_CHANGE', 'PROMO_CHANGE', 'OUTLET_CHANGE'] },
  { value: 'BULK', label: 'Operasi Massal', icon: Layers, eventTypes: ['MIGRATION_BATCH', 'BULK_BATCH'] },
  { value: 'LEGACY', label: 'Legacy', icon: Package, eventTypes: ['LEGACY'] },
]

/** Resolve the current group key → comma-separated eventType string for the API. */
function groupToEventTypeParam(group: string): string {
  if (group === 'ALL') return ''
  const tab = EVENT_GROUP_TABS.find((t) => t.value === group)
  return tab && tab.eventTypes.length > 0 ? tab.eventTypes.join(',') : ''
}

const EVENT_TYPE_BADGE: Record<string, string> = {
  MIGRATION_BATCH: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  BULK_BATCH: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  SALE: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  VOID: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  PURCHASE: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  INVENTORY_ADJUSTMENT: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  COMPOSITION_UPDATE: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  CUSTOMER_CHANGE: 'bg-lime-500/15 text-lime-600 dark:text-lime-400',
  PRODUCT_CHANGE: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  INVENTORY_ITEM_CHANGE: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  PRODUCT_CATEGORY_CHANGE: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  INVENTORY_CATEGORY_CHANGE: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  SUPPLIER_CHANGE: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  CREW_CHANGE: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  PROMO_CHANGE: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  OUTLET_CHANGE: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  LEGACY: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
}

const TONE_BADGE: Record<AuditSectionTone, string> = {
  default: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  info: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  danger: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
}

const TONE_LABEL: Record<AuditSectionTone, string> = {
  default: 'Info',
  info: 'Info',
  success: 'Sukses',
  warning: 'Peringatan',
  danger: 'Error',
}

const SECTION_ORDER: AuditSectionType[] = [
  'summary',
  'changes',
  'inventory',
  'errors',
  'warnings',
  'skipped',
  'metadata',
]

// ==================== HELPERS ====================

/**
 * safeText — never returns "[object Object]".
 * Strings pass through; null/undefined → "—"; objects → JSON.stringify;
 * other primitives → String(v).
 */
function safeText(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function eventTypeBadgeClass(eventType: EventType): string {
  if (!eventType) return EVENT_TYPE_BADGE.LEGACY
  return EVENT_TYPE_BADGE[eventType] || EVENT_TYPE_BADGE.LEGACY
}

function eventTypeLabel(eventType: EventType): string {
  if (!eventType) return 'LEGACY'
  return eventType
}

function toneBadgeClass(tone?: AuditSectionTone): string {
  if (!tone) return TONE_BADGE.default
  return TONE_BADGE[tone] || TONE_BADGE.default
}

function toneLabel(tone?: AuditSectionTone): string {
  return TONE_LABEL[tone || 'default'] || 'Info'
}

/**
 * Fields that should be rendered as "hero metrics" (big numbers) in the
 * mobile summary grid, as opposed to metadata (Mode, File, Batch, etc.).
 */
const METRIC_FIELD_KEYS = new Set([
  'Status',
  'Processed',
  'Created',
  'Skipped',
  'Failed',
  'Inventory Items Created',
  'Compositions Created',
  'Total Stock',
  'Total Modal Value',
  'Updated',
  'Deleted',
])

/** Metadata keys rendered as a compact strip above the metric grid. */
const METADATA_FIELD_KEYS = new Set([
  'Mode',
  'File',
  'Batch',
  'Operation ID',
  'Operation',
  'Job ID',
])

function isMetricField(key: string): boolean {
  return METRIC_FIELD_KEYS.has(key)
}

function isMetadataField(key: string): boolean {
  return METADATA_FIELD_KEYS.has(key)
}

/**
 * Convert AuditSection items + columns into MobileResultColumn[] for the
 * MobileResultList component. The "name" or "entity" column is marked as
 * primary so it renders prominently on the mobile card.
 */
function toMobileResultColumns(columns: string[]): MobileResultColumn[] {
  return columns.map((c) => {
    const lower = c.toLowerCase()
    const isPrimary = lower === 'name' || lower === 'entity'
    // Hide "row" on mobile card — it's shown as a badge instead.
    const hideOnMobile = lower === 'row'
    return {
      key: c,
      label: c,
      primary: isPrimary,
      hideOnMobile,
    }
  })
}

function parseSections(sections: string | null): AuditSection[] {
  if (!sections) return []
  try {
    const parsed = JSON.parse(sections)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is AuditSection => {
      return (
        typeof s === 'object' &&
        s !== null &&
        typeof s.type === 'string' &&
        typeof s.label === 'string'
      )
    })
  } catch {
    return []
  }
}

function parseDetailsFallback(
  details: string | null
): string | Record<string, unknown> | null {
  if (!details) return null
  try {
    const parsed = JSON.parse(details)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>
    }
    return String(parsed)
  } catch {
    return details
  }
}

function triggerDownload(
  filename: string,
  contentType: string,
  data: string,
  encoding?: 'text' | 'base64'
) {
  let bytes: BlobPart
  if (encoding === 'base64') {
    try {
      const bin = atob(data)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      bytes = arr
    } catch {
      bytes = data
    }
  } else {
    bytes = data
  }
  const blob = new Blob([bytes], {
    type: contentType || 'application/octet-stream',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 1000)
}

function truncateDetails(details: string | null, max = 120): string {
  if (!details) return '—'
  const parsed = parseDetailsFallback(details)
  if (parsed === null) return '—'
  if (typeof parsed === 'string') {
    return parsed.length > max ? parsed.slice(0, max) + '…' : parsed
  }
  const entries = Object.entries(parsed) as [string, unknown][]
  const parts = entries.slice(0, 4).map(([k, v]) => `${k}=${safeText(v)}`)
  let joined = parts.join(', ')
  if (entries.length > 4) joined += `, +${entries.length - 4}`
  if (joined.length > max) joined = joined.slice(0, max) + '…'
  return joined
}

// ==================== EVENT BADGE ====================
function EventBadge({
  eventType,
  className,
}: {
  eventType: EventType
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={`border-transparent ${eventTypeBadgeClass(eventType)} text-[10px] px-1.5 py-0 ${className ?? ''}`}
    >
      {eventTypeLabel(eventType)}
    </Badge>
  )
}

// ==================== SECTION BLOCK ====================
function SectionBlock({ section }: { section: AuditSection }) {
  const hasFields = Array.isArray(section.fields) && section.fields.length > 0
  const hasItems = Array.isArray(section.items) && section.items.length > 0
  const hasDownload = !!section.download
  // Hooks MUST be called before any early return (Rules of Hooks).
  const [expanded, setExpanded] = useState(false)
  const isMobile = useIsMobile()
  if (!hasFields && !hasItems && !hasDownload) return null

  const items = (section.items || []) as Record<string, string>[]
  const columns =
    section.columns && section.columns.length > 0
      ? section.columns
      : items.length > 0
        ? Object.keys(items[0])
        : []

  const shouldCollapse = section.collapsed === true || items.length > 10
  const visibleItems =
    shouldCollapse && !expanded ? items.slice(0, 5) : items

  // Split summary fields into metrics vs metadata for the mobile grid.
  const fields = (section.fields as AuditField[]) || []
  const metricFields = fields.filter((f) => isMetricField(safeText(f.k)))
  const metadataFields = fields.filter((f) => isMetadataField(safeText(f.k)))
  const otherFields = fields.filter(
    (f) => !isMetricField(safeText(f.k)) && !isMetadataField(safeText(f.k)),
  )

  return (
    <Card className="bg-white/[0.02] border-white/[0.06] py-0 gap-3 rounded-xl overflow-hidden">
      <CardHeader className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-semibold text-slate-200">
            {section.label}
          </CardTitle>
          <Badge
            variant="outline"
            className={`border-transparent ${toneBadgeClass(section.tone)} text-[9px] px-1.5 py-0`}
          >
            {toneLabel(section.tone)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 text-xs space-y-3">
        {hasFields && isMobile && (
          <>
            {/* Metadata strip (Mode, File, Batch, etc.) */}
            {metadataFields.length > 0 && (
              <div className="space-y-1 pb-2 border-b border-white/[0.04]">
                {metadataFields.map((f, i) => (
                  <div
                    key={`meta-${f.k}-${i}`}
                    className="flex items-center gap-2 text-[11px] min-w-0"
                  >
                    <span className="text-slate-600 shrink-0">{safeText(f.k)}:</span>
                    <span className="text-slate-400 break-words line-clamp-2 min-w-0">
                      {safeText(f.v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Metric grid — 2 columns, compact */}
            {metricFields.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {metricFields.map((f, i) => {
                  const val = safeText(f.v)
                  const isStatus = safeText(f.k).toLowerCase() === 'status'
                  return (
                    <div
                      key={`metric-${f.k}-${i}`}
                      className="rounded-lg bg-white/[0.03] border border-white/[0.04] px-2.5 py-2 min-w-0"
                    >
                      <p className="text-[9px] text-slate-500 uppercase tracking-wide truncate mb-0.5">
                        {safeText(f.k)}
                      </p>
                      <p
                        className={`text-sm font-bold tabular-nums break-words leading-tight ${
                          isStatus
                            ? val.toLowerCase().includes('fail')
                              ? 'text-red-400'
                              : val.toLowerCase().includes('partial') || val.toLowerCase().includes('warn')
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            : 'text-white'
                        }`}
                      >
                        {val}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
            {/* Other fields (not metric, not metadata) — compact list */}
            {otherFields.length > 0 && (
              <dl className="grid grid-cols-1 gap-y-1.5">
                {otherFields.map((f, i) => (
                  <div key={`other-${f.k}-${i}`} className="flex flex-col gap-0.5 min-w-0">
                    <dt className="text-[10px] text-slate-500 uppercase tracking-wide truncate">
                      {safeText(f.k)}
                    </dt>
                    <dd className="text-slate-200 break-words text-xs">
                      {safeText(f.v)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}

        {hasFields && !isMobile && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {fields.map((f, i) => (
              <div key={`${f.k}-${i}`} className="flex flex-col gap-0.5 min-w-0">
                <dt className="text-[10px] text-slate-500 uppercase tracking-wide truncate">
                  {safeText(f.k)}
                </dt>
                <dd className="text-slate-200 break-words text-xs">
                  {safeText(f.v)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {hasItems && (
          <MobileResultList
            columns={toMobileResultColumns(columns)}
            rows={visibleItems}
            defaultCollapsed={shouldCollapse}
            collapseLabel={(total) => `Tampilkan semua (${total})`}
            emptyMessage="Tidak ada data"
          />
        )}

        {shouldCollapse && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline"
          >
            {expanded
              ? 'Sembunyikan'
              : `Tampilkan semua (${items.length})`}
          </button>
        )}

        {hasDownload && section.download && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px] bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] gap-1.5"
              onClick={() =>
                triggerDownload(
                  section.download!.filename,
                  section.download!.contentType,
                  section.download!.data,
                  section.download!.encoding
                )
              }
            >
              <Download className="h-3 w-3" />
              {section.download.filename}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ==================== LEGACY DETAILS BLOCK ====================
function LegacyDetailsBlock({ details }: { details: string | null }) {
  const parsed = parseDetailsFallback(details)
  if (parsed === null) {
    return (
      <div className="text-xs text-slate-500 italic">Tidak ada detail</div>
    )
  }
  if (typeof parsed === 'string') {
    return (
      <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words bg-white/[0.02] rounded-lg p-3 border border-white/[0.06] overflow-x-auto">
        {parsed}
      </pre>
    )
  }
  const entries = Object.entries(parsed) as [string, unknown][]
  return (
    <Card className="bg-white/[0.02] border-white/[0.06] py-0 gap-3 rounded-xl overflow-hidden">
      <CardHeader className="px-4 pt-3 pb-2">
        <CardTitle className="text-xs font-semibold text-slate-200">
          Detail (Legacy)
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 text-xs">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 min-w-0">
              <dt className="text-[10px] text-slate-500 uppercase tracking-wide truncate">
                {safeText(k)}
              </dt>
              <dd className="text-slate-200 break-words text-xs">
                {safeText(v)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

// ==================== DETAIL CONTENT ====================

/**
 * Group parsed sections into mobile tabs:
 *  - summary: summary + inventory + metadata
 *  - created: changes
 *  - skipped: skipped
 *  - errors: errors + warnings
 */
function groupSectionsForTabs(sections: AuditSection[]) {
  const summarySections = sections.filter(
    (s) => s.type === 'summary' || s.type === 'inventory' || s.type === 'metadata',
  )
  const createdSections = sections.filter((s) => s.type === 'changes')
  const skippedSections = sections.filter((s) => s.type === 'skipped')
  const errorSections = sections.filter(
    (s) => s.type === 'errors' || s.type === 'warnings',
  )
  return { summarySections, createdSections, skippedSections, errorSections }
}

/** Count total items across sections (for tab badges). */
function countSectionItems(sections: AuditSection[]): number {
  return sections.reduce((sum, s) => sum + (s.items?.length ?? 0), 0)
}

function DetailContent({ log }: { log: AuditLog }) {
  const sections = parseSections(log.sections)
  const title = log.title || `${log.action} · ${log.entityType}`
  const showLegacyFallback = sections.length === 0 && !!log.details
  const isMobile = useIsMobile()

  // Group sections by type in the required order (desktop)
  const grouped = SECTION_ORDER.map((type) => ({
    type,
    items: sections.filter((s) => s.type === type),
  })).filter((g) => g.items.length > 0)

  // Group sections into tabs (mobile)
  const { summarySections, createdSections, skippedSections, errorSections } =
    groupSectionsForTabs(sections)

  // Show batch-export for inventory / purchase source entities
  const sourceType = log.sourceEntityType || log.entityType
  const sourceId = log.sourceEntityId || log.entityId
  const canBatchExport =
    !!sourceId &&
    (sourceType === 'INVENTORY_ITEM' || sourceType === 'PURCHASE_ORDER')

  const batchExportNode = canBatchExport ? (
    <ProGate feature="exportExcel" label="Export Batch Detail" variant="inline">
      <BatchExportButton entityType={sourceType} entityId={sourceId || ''} />
    </ProGate>
  ) : null

  // ── Mobile: tabbed layout (header is in the MobileFullScreenSheet) ──
  if (isMobile) {
    const hasCreated = createdSections.length > 0
    const hasSkipped = skippedSections.length > 0
    const hasErrors = errorSections.length > 0
    const hasSummary = summarySections.length > 0
    const createdCount = countSectionItems(createdSections)
    const skippedCount = countSectionItems(skippedSections)
    const errorCount = countSectionItems(errorSections)

    return (
      <div className="space-y-3">
        {showLegacyFallback ? (
          <LegacyDetailsBlock details={log.details} />
        ) : (
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="bg-white/[0.04] border border-white/[0.06] h-9 p-0.5 rounded-lg grid grid-cols-4 w-full mb-3">
              <TabsTrigger
                value="summary"
                className="text-[10px] font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 gap-0.5"
              >
                Ringkasan
              </TabsTrigger>
              <TabsTrigger
                value="created"
                disabled={!hasCreated}
                className="text-[10px] font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 gap-0.5 disabled:opacity-30"
              >
                Dibuat{hasCreated ? ` (${createdCount})` : ''}
              </TabsTrigger>
              <TabsTrigger
                value="skipped"
                disabled={!hasSkipped}
                className="text-[10px] font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 gap-0.5 disabled:opacity-30"
              >
                Skip{hasSkipped ? ` (${skippedCount})` : ''}
              </TabsTrigger>
              <TabsTrigger
                value="errors"
                disabled={!hasErrors}
                className="text-[10px] font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 gap-0.5 disabled:opacity-30"
              >
                Error{hasErrors ? ` (${errorCount})` : ''}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="space-y-2 mt-0">
              {hasSummary ? (
                summarySections.map((section, idx) => (
                  <SectionBlock key={`summary-${idx}`} section={section} />
                ))
              ) : (
                <div className="text-xs text-slate-500 italic">
                  Tidak ada ringkasan
                </div>
              )}
              {batchExportNode && (
                <div className="pt-2">{batchExportNode}</div>
              )}
            </TabsContent>

            <TabsContent value="created" className="space-y-2 mt-0">
              {createdSections.map((section, idx) => (
                <SectionBlock key={`created-${idx}`} section={section} />
              ))}
            </TabsContent>

            <TabsContent value="skipped" className="space-y-2 mt-0">
              {skippedSections.map((section, idx) => (
                <SectionBlock key={`skipped-${idx}`} section={section} />
              ))}
            </TabsContent>

            <TabsContent value="errors" className="space-y-2 mt-0">
              {errorSections.map((section, idx) => (
                <SectionBlock key={`errors-${idx}`} section={section} />
              ))}
            </TabsContent>
          </Tabs>
        )}
      </div>
    )
  }

  // ── Desktop: stacked layout with header ──
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <EventBadge eventType={log.eventType} />
          {log.operationId && (
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-400 text-[10px] font-mono max-w-[300px] truncate"
            >
              op: {log.operationId}
            </Badge>
          )}
        </div>
        <h2 className="text-base font-semibold text-white break-words line-clamp-3">
          {safeText(title)}
        </h2>
        {log.summary && (
          <p className="text-xs text-slate-400 break-words">
            {safeText(log.summary)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
          {log.sourceEntityType && (
            <span>
              <span className="text-slate-600">Source:</span>{' '}
              <span className="text-slate-400">
                {safeText(log.sourceEntityType)}
              </span>
            </span>
          )}
          <span>
            <span className="text-slate-600">User:</span>{' '}
            <span className="text-slate-400">
              {log.user?.name || 'System'}
            </span>
          </span>
          <span>
            <span className="text-slate-600">Waktu:</span>{' '}
            <span className="text-slate-400">
              {formatDate(log.createdAt)}
            </span>
          </span>
        </div>
      </div>

      <Separator className="bg-white/[0.06]" />

      {/* Sections in required order */}
      {grouped.length > 0 ? (
        <div className="space-y-3">
          {grouped.map((g) => (
            <div key={g.type} className="space-y-2">
              {g.items.map((section, idx) => (
                <SectionBlock key={`${g.type}-${idx}`} section={section} />
              ))}
            </div>
          ))}
        </div>
      ) : showLegacyFallback ? (
        <LegacyDetailsBlock details={log.details} />
      ) : (
        <div className="text-xs text-slate-500 italic">
          Tidak ada detail tambahan
        </div>
      )}

      {/* Batch export button (Pro-gated, preserved from V1) */}
      {canBatchExport && (
        <>
          <Separator className="bg-white/[0.06]" />
          <div className="flex justify-end">
            <ProGate
              feature="exportExcel"
              label="Export Batch Detail"
              variant="inline"
            >
              <BatchExportButton
                entityType={sourceType}
                entityId={sourceId || ''}
              />
            </ProGate>
          </div>
        </>
      )}
    </div>
  )
}

// ==================== BATCH EXPORT BUTTON ====================
function BatchExportButton({
  entityType,
  entityId,
}: {
  entityType: string
  entityId: string
}) {
  const [busy, setBusy] = useState(false)
  const handleClick = async () => {
    setBusy(true)
    try {
      const res = await fetch(
        `/api/audit-logs/batch-export?entityType=${entityType}&entityId=${entityId}`,
        { credentials: 'include' }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || `Export gagal (${res.status})`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `batch-detail-${entityType}-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      setTimeout(() => {
        a.remove()
        URL.revokeObjectURL(url)
      }, 1000)
      toast.success('Export berhasil diunduh')
    } catch {
      toast.error('Gagal mengekspor. Coba lagi.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button
      onClick={handleClick}
      disabled={busy}
      variant="outline"
      className="h-8 text-xs bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] gap-1.5"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {busy ? 'Mengunduh...' : 'Export Batch Detail'}
    </Button>
  )
}

// ==================== MOBILE LOG CARD ====================
function MobileLogCard({
  log,
  onClick,
}: {
  log: AuditLog
  onClick: () => void
}) {
  const title = log.title || `${log.action} · ${log.entityType}`
  const summary = log.summary || truncateDetails(log.details)
  return (
    <div
      onClick={onClick}
      className="rounded-xl border border-white/[0.06] bg-nebula p-3 transition-colors cursor-pointer hover:bg-white/[0.03]"
    >
      <div className="flex items-start gap-2 mb-1.5">
        <EventBadge eventType={log.eventType} />
        <span className="text-[10px] text-slate-500 ml-auto whitespace-nowrap">
          {formatDate(log.createdAt)}
        </span>
      </div>
      <p className="text-xs font-medium text-slate-200 mb-1 line-clamp-2 break-words">
        {safeText(title)}
      </p>
      <p className="text-[11px] text-slate-400 line-clamp-1 break-words">
        {safeText(summary)}
      </p>
      <p className="text-[10px] text-slate-500 mt-1.5">
        <span>oleh</span>{' '}
        <span className="text-slate-400">
          {log.user?.name || 'System'}
        </span>
      </p>
    </div>
  )
}

// ==================== MAIN PAGE ====================
export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('ALL')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const isMobile = useIsMobile()
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null)
  const [exporting, setExporting] = useState(false)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      })
      const eventTypeParam = groupToEventTypeParam(activeTab)
      if (eventTypeParam) params.set('eventType', eventTypeParam)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)
      if (search) params.set('search', search)

      const res = await fetch(`/api/audit-logs?${params}`, {
        credentials: 'include',
      })
      if (res.ok) {
        const data: AuditLogListResponse = await res.json()
        setLogs(Array.isArray(data.logs) ? data.logs.filter(Boolean) : [])
        setTotalPages(Math.max(1, data.totalPages || 1))
      } else {
        toast.error('Gagal memuat audit log')
        setLogs([])
      }
    } catch {
      toast.error('Gagal memuat audit log')
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [page, activeTab, dateFrom, dateTo, search])

  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs])

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    setPage(1)
  }

  const handleFilter = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const handleClearSearch = () => {
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFilter()
  }

  const handleClearAllFilters = () => {
    setDateFrom('')
    setDateTo('')
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const downloadExportBlob = async (
    url: string,
    filename: string,
    loadingSetter: (v: boolean) => void
  ) => {
    loadingSetter(true)
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || `Export gagal (${res.status})`)
        return
      }
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      setTimeout(() => {
        a.remove()
        URL.revokeObjectURL(blobUrl)
      }, 1000)
      toast.success('Export berhasil diunduh')
    } catch {
      toast.error('Gagal mengekspor. Coba lagi.')
    } finally {
      loadingSetter(false)
    }
  }

  const handleExport = () => {
    const params = new URLSearchParams()
    const eventTypeParam = groupToEventTypeParam(activeTab)
    if (eventTypeParam) params.set('eventType', eventTypeParam)
    if (search) params.set('search', search)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    void downloadExportBlob(
      `/api/audit-logs/export?${params}`,
      `audit-log-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
      setExporting
    )
  }

  const hasActiveFilters = !!(search || dateFrom || dateTo || activeTab !== 'ALL')

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">Audit Log</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Lacak semua aktivitas dan perubahan sistem
          </p>
        </div>
        <Button
          onClick={handleExport}
          disabled={exporting}
          variant="outline"
          className="h-9 sm:h-8 text-xs bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] gap-1.5 shrink-0"
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {exporting ? 'Mengunduh...' : 'Export'}
        </Button>
      </div>

      {/* Tabs (event-group filter) — 7 business-domain groups instead of 18 raw event types */}
      <div className="shrink-0">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="overflow-x-auto -mx-1 px-1 pb-1">
            <TabsList className="bg-white/[0.04] border border-white/[0.06] h-9 p-0.5 rounded-lg inline-flex w-max">
              {EVENT_GROUP_TABS.map((tab) => {
                const Icon = tab.icon
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="text-xs font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 px-3 gap-1.5"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>
        </Tabs>
      </div>

      {/* Search + Date Filters */}
      <div className="flex flex-col sm:flex-row gap-2 shrink-0">
        <div className="relative flex-1 min-w-0 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
          <Input
            type="text"
            placeholder="Cari judul, ringkasan, user..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-8 pr-8 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs placeholder:text-slate-500"
          />
          {searchInput && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <DateFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => {
            setDateFrom(from)
            setDateTo(to)
            setPage(1)
          }}
        />

        {hasActiveFilters && (
          <Button
            variant="ghost"
            className="h-8 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] shrink-0"
            onClick={handleClearAllFilters}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Reset
          </Button>
        )}
      </div>

      {/* Active filter badges */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {activeTab !== 'ALL' && (
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5"
            >
              Grup: {EVENT_GROUP_TABS.find((t) => t.value === activeTab)?.label || activeTab}
              <button onClick={() => { setActiveTab('ALL'); setPage(1) }}>
                <X className="h-2.5 w-2.5 ml-0.5" />
              </button>
            </Badge>
          )}
          {search && (
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5"
            >
              Cari: &quot;{search}&quot;
              <button
                onClick={() => {
                  setSearchInput('')
                  setSearch('')
                  setPage(1)
                }}
              >
                <X className="h-2.5 w-2.5 ml-0.5" />
              </button>
            </Badge>
          )}
          {dateFrom && (
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5"
            >
              {dateFrom}
              {dateTo && dateTo !== dateFrom ? ` – ${dateTo}` : ''}
              <button
                onClick={() => {
                  setDateFrom('')
                  setDateTo('')
                  setPage(1)
                }}
              >
                <X className="h-2.5 w-2.5 ml-0.5" />
              </button>
            </Badge>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 bg-nebula rounded-xl" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-nebula p-8 text-center">
            <Search className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-xs text-slate-500">
              {hasActiveFilters
                ? 'Tidak ada audit log yang cocok'
                : 'Belum ada audit log'}
            </p>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setActiveTab('ALL')
                  handleClearAllFilters()
                }}
                className="mt-3 text-slate-500 hover:text-slate-300 text-xs h-7"
              >
                Reset semua filter
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="md:hidden space-y-2">
              {logs.map((log) => (
                <MobileLogCard
                  key={log.id}
                  log={log}
                  onClick={() => setDetailLog(log)}
                />
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden md:block rounded-xl border border-white/[0.06] overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/[0.06] hover:bg-transparent bg-nebula/50">
                      <TableHead className="text-slate-500 text-[11px] font-medium whitespace-nowrap">
                        Waktu
                      </TableHead>
                      <TableHead className="text-slate-500 text-[11px] font-medium">
                        Event
                      </TableHead>
                      <TableHead className="text-slate-500 text-[11px] font-medium">
                        Ringkasan
                      </TableHead>
                      <TableHead className="text-slate-500 text-[11px] font-medium whitespace-nowrap">
                        User
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => {
                      const title =
                        log.title || `${log.action} · ${log.entityType}`
                      const summary =
                        log.summary || truncateDetails(log.details)
                      return (
                        <TableRow
                          key={log.id}
                          className="border-white/[0.06] hover:bg-white/[0.02] cursor-pointer"
                          onClick={() => setDetailLog(log)}
                        >
                          <TableCell className="text-xs text-slate-400 py-3 px-3 whitespace-nowrap align-top">
                            {formatDate(log.createdAt)}
                          </TableCell>
                          <TableCell className="py-3 px-3 align-top">
                            <div className="flex flex-col gap-1 min-w-[140px]">
                              <EventBadge eventType={log.eventType} />
                              <span className="text-xs text-slate-200 line-clamp-1 break-words">
                                {safeText(title)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-slate-400 py-3 px-3 align-top">
                            <span className="line-clamp-1 break-words">
                              {safeText(summary)}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-slate-300 py-3 px-3 whitespace-nowrap align-top">
                            {log.user?.name || 'System'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      <div className="shrink-0 pt-2">
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </div>

      {/* ── Detail Dialog ──
          Mobile: full-screen sheet with sticky header + single scroll.
          Desktop: centered ResponsiveDialog with stacked sections. */}
      {isMobile ? (
        <MobileFullScreenSheet
          open={!!detailLog}
          onOpenChange={(open) => { if (!open) setDetailLog(null) }}
          title={detailLog ? safeText(detailLog.title || `${detailLog.action} · ${detailLog.entityType}`) : ''}
          subtitle={
            detailLog
              ? `${detailLog.user?.name || 'System'} · ${formatDate(detailLog.createdAt)}`
              : undefined
          }
          badges={
            detailLog ? (
              <>
                <EventBadge eventType={detailLog.eventType} />
                {detailLog.operationId && (
                  <Badge
                    variant="outline"
                    className="bg-white/[0.04] border-white/[0.08] text-slate-400 text-[10px] font-mono max-w-[200px] truncate"
                  >
                    op: {detailLog.operationId}
                  </Badge>
                )}
              </>
            ) : undefined
          }
        >
          {detailLog && <DetailContent key={detailLog.id} log={detailLog} />}
        </MobileFullScreenSheet>
      ) : (
        <ResponsiveDialog
          open={!!detailLog}
          onOpenChange={(open) => {
            if (!open) setDetailLog(null)
          }}
        >
          <ResponsiveDialogContent className="bg-nebula border-white/[0.06] sm:max-w-2xl">
            {detailLog && <DetailContent key={detailLog.id} log={detailLog} />}
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}
    </div>
  )
}
