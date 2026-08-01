'use client'

/**
 * StockOpnameModeSelector — V3.1 start page mode selector.
 *
 * Visual hierarchy matches the Purchase → "Pilih Metode Input" pattern:
 *   - icon block on the left (w-10 h-10 rounded-xl)
 *   - title + two-line description + small suitability hint
 *   - selected card: subtle amber tint + amber border + active icon + checkmark
 *   - unselected cards: neutral background + clear hover state
 *   - equal card heights (h-full + flex)
 *
 * The active mode's configuration panel renders below the selector. Each panel
 * owns its mode-specific content (category list / item picker) plus a shared
 * `ZeroStockSetting` row. The single `StockOpnameSessionSummary` lives at the
 * page level (not duplicated inside the panels).
 *
 * This is a controlled component — the parent owns the state and passes
 * `mode` + `onChange`.
 */

import { useMemo, useState, useEffect } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Boxes, Layers, MousePointerClick, Search, X, PackageOpen, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MODE_OPTIONS,
  type OpnameScope,
  type OpnameCategory,
} from './types'

// ════════════════════════════════════════════════════════════
// Mode Selector (3 cards — Purchase input-method style)
// ════════════════════════════════════════════════════════════

const MODE_ICONS: Record<OpnameScope, React.ReactNode> = {
  ALL_ITEMS: <Boxes className="h-5 w-5" />,
  CATEGORY: <Layers className="h-5 w-5" />,
  SELECTED_ITEMS: <MousePointerClick className="h-5 w-5" />,
}

export function StockOpnameModeSelector({
  mode,
  onChange,
}: {
  mode: OpnameScope
  onChange: (mode: OpnameScope) => void
}) {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {MODE_OPTIONS.map((opt) => {
          const selected = mode === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                'group relative h-full rounded-xl border p-4 text-left transition-all duration-200',
                selected
                  ? 'border-amber-500/50 bg-amber-500/[0.06]'
                  : 'border-border bg-card hover:border-amber-500/30 hover:bg-amber-500/[0.02]'
              )}
            >
              {/* Selected checkmark — top-right */}
              {selected && (
                <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-amber-500 shrink-0" />
              )}
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors',
                    selected
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-muted text-muted-foreground group-hover:bg-amber-500/10 group-hover:text-amber-500'
                  )}
                >
                  {MODE_ICONS[opt.value]}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'text-sm font-medium transition-colors',
                      selected
                        ? 'text-foreground'
                        : 'text-foreground group-hover:text-amber-600 dark:group-hover:text-amber-400'
                    )}
                  >
                    {opt.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {opt.description}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2.5 text-[10px] text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    <span>{opt.hint}</span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Shared: Zero-stock setting row (belongs inside the configuration section)
// ════════════════════════════════════════════════════════════

export function ZeroStockSetting({
  includeZeroStock,
  onIncludeZeroStockChange,
}: {
  includeZeroStock: boolean
  onIncludeZeroStockChange: (v: boolean) => void
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <Checkbox
          checked={includeZeroStock}
          onCheckedChange={(v) => onIncludeZeroStockChange(v === true)}
          className="mt-0.5"
        />
        <div className="flex-1">
          <div className="text-sm font-medium">Sertakan item dengan stok 0</div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Item tanpa stok sistem tetap masuk daftar hitungan untuk konfirmasi stok fisik.
          </div>
        </div>
      </label>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Mode A — ALL ITEMS panel
// ════════════════════════════════════════════════════════════

export function AllItemsModePanel({
  includeZeroStock,
  onIncludeZeroStockChange,
}: {
  includeZeroStock: boolean
  onIncludeZeroStockChange: (v: boolean) => void
}) {
  // No mode-specific picker — only the shared zero-stock setting.
  return (
    <ZeroStockSetting
      includeZeroStock={includeZeroStock}
      onIncludeZeroStockChange={onIncludeZeroStockChange}
    />
  )
}

// ════════════════════════════════════════════════════════════
// Mode B — CATEGORY panel
// ════════════════════════════════════════════════════════════

export function CategoryModePanel({
  categories,
  selectedIds,
  onSelectedIdsChange,
  includeZeroStock,
  onIncludeZeroStockChange,
  loading,
}: {
  categories: OpnameCategory[]
  selectedIds: string[]
  onSelectedIdsChange: (ids: string[]) => void
  includeZeroStock: boolean
  onIncludeZeroStockChange: (v: boolean) => void
  loading: boolean
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query) return categories
    const q = query.toLowerCase()
    return categories.filter((c) => c.name.toLowerCase().includes(q))
  }, [categories, query])

  // Empty state — intentional, not a dead box
  if (!loading && categories.length === 0) {
    return (
      <div className="space-y-3">
        <div className="p-5 rounded-lg border border-dashed border-border text-center">
          <PackageOpen className="h-7 w-7 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm font-medium">Belum ada kategori inventory.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Gunakan mode Semua Item atau buat kategori terlebih dahulu.
          </p>
        </div>
        <ZeroStockSetting
          includeZeroStock={includeZeroStock}
          onIncludeZeroStockChange={onIncludeZeroStockChange}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Selected category chips */}
      {selectedIds.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            Kategori Dipilih ({selectedIds.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedIds.map((id) => {
              const cat = categories.find((c) => c.id === id)
              if (!cat) return null
              return (
                <Badge
                  key={id}
                  variant="outline"
                  className="gap-1 pr-1.5 pl-2.5 py-1 bg-amber-500/5 border-amber-500/30 text-amber-700 dark:text-amber-400"
                >
                  {cat.name}
                  <button
                    type="button"
                    onClick={() => onSelectedIdsChange(selectedIds.filter((x) => x !== id))}
                    className="rounded-full hover:bg-amber-500/10 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )
            })}
          </div>
        </div>
      )}

      {/* Search + list */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Cari kategori..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-border p-1.5">
        {loading ? (
          <div className="space-y-1.5 p-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            Tidak ada kategori yang cocok.
          </div>
        ) : (
          filtered.map((cat) => {
            const checked = selectedIds.includes(cat.id)
            return (
              <label
                key={cat.id}
                className={cn(
                  'flex items-center gap-2 cursor-pointer text-sm p-1.5 rounded',
                  checked ? 'bg-amber-500/5' : 'hover:bg-muted/50'
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => {
                    onSelectedIdsChange(
                      checked
                        ? selectedIds.filter((x) => x !== cat.id)
                        : [...selectedIds, cat.id]
                    )
                  }}
                />
                <span className="flex-1">{cat.name}</span>
                <Badge variant="outline" className="text-xs tabular-nums">
                  {cat.itemCount}
                </Badge>
              </label>
            )
          })
        )}
      </div>

      <ZeroStockSetting
        includeZeroStock={includeZeroStock}
        onIncludeZeroStockChange={onIncludeZeroStockChange}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Mode C — SELECTED ITEMS panel (searchable picker + selected list)
// ════════════════════════════════════════════════════════════

interface PickerItem {
  inventoryItemId: string
  itemName: string
  itemSku: string | null
  categoryName: string | null
  systemQty: number
  itemUnit: string
}

export function SelectedItemsModePanel({
  selectedIds,
  onSelectedIdsChange,
  includeZeroStock,
  onIncludeZeroStockChange,
  fetchItems,
}: {
  // Parent only tracks IDs — the panel resolves the full PickerItem[]
  // from its own fetched `allItems`. This avoids a stale-state race where
  // the parent would otherwise have to refetch item details whenever the
  // user toggles an item.
  selectedIds: string[]
  onSelectedIdsChange: (ids: string[]) => void
  includeZeroStock: boolean
  onIncludeZeroStockChange: (v: boolean) => void
  fetchItems: () => Promise<PickerItem[]>
}) {
  const [query, setQuery] = useState('')
  const [allItems, setAllItems] = useState<PickerItem[]>([])
  // Initialize to `true` for first render. Subsequent refetches (when
  // includeZeroStock changes) keep old items visible until new ones arrive.
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchItems()
      .then((items) => {
        if (cancelled) return
        setAllItems(items)
      })
      .catch((err) => console.error('[SelectedItemsModePanel]', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchItems])

  const searchResults = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return allItems
      .filter(
        (i) =>
          i.itemName.toLowerCase().includes(q) ||
          i.itemSku?.toLowerCase().includes(q)
      )
      .slice(0, 20)
  }, [allItems, query])

  // Resolve full PickerItem objects for the currently-selected IDs from the
  // fetched `allItems`. Falls back to an empty array while items are still
  // loading. This is the data source for the "Item Terpilih" list and the
  // remove / Hapus Semua controls.
  const selectedItems = useMemo(
    () => allItems.filter((i) => selectedIds.includes(i.inventoryItemId)),
    [allItems, selectedIds],
  )

  const toggle = (item: PickerItem) => {
    if (selectedIds.includes(item.inventoryItemId)) {
      onSelectedIdsChange(selectedIds.filter((x) => x !== item.inventoryItemId))
    } else {
      onSelectedIdsChange([...selectedIds, item.inventoryItemId])
    }
  }

  return (
    <div className="space-y-3">
      {/* Search to add items */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Cari nama, SKU, atau barcode..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      {/* Search results */}
      {query.trim() && (
        <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-border p-1.5">
          {loading ? (
            <div className="space-y-1.5 p-1">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : searchResults.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              Tidak ada item yang cocok.
            </div>
          ) : (
            searchResults.map((item) => {
              const isSelected = selectedIds.includes(item.inventoryItemId)
              return (
                <div
                  key={item.inventoryItemId}
                  className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{item.itemName}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.itemSku || '-'} · {item.categoryName || 'Tanpa Kategori'} · stok{' '}
                      {item.systemQty}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={isSelected ? 'outline' : 'default'}
                    className="h-7 text-xs"
                    onClick={() => toggle(item)}
                    disabled={isSelected}
                  >
                    {isSelected ? 'Dipilih' : 'Tambah'}
                  </Button>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Selected items list — shown when at least one ID is selected.
          `selectedItems` is derived from `allItems` + `selectedIds`, so it
          updates immediately when the user clicks Tambah / X / Hapus Semua,
          even before the parent's preview API call returns. */}
      {selectedItems.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Item Terpilih ({selectedItems.length})
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => onSelectedIdsChange([])}
            >
              Hapus Semua
            </Button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-border p-1.5">
            {selectedItems.map((item) => (
              <div
                key={item.inventoryItemId}
                className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{item.itemName}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.itemSku || '-'} · stok {item.systemQty} {item.itemUnit}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    onSelectedIdsChange(
                      selectedIds.filter((x) => x !== item.inventoryItemId)
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ZeroStockSetting
        includeZeroStock={includeZeroStock}
        onIncludeZeroStockChange={onIncludeZeroStockChange}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Session Summary — one compact panel (item count · mode · zero-stock · snapshot)
// ════════════════════════════════════════════════════════════

export function StockOpnameSessionSummary({
  mode,
  itemCount,
  categoryCount,
  includeZeroStock,
  loading,
}: {
  mode: OpnameScope
  itemCount: number
  categoryCount: number
  includeZeroStock: boolean
  loading: boolean
}) {
  const modeLabel =
    mode === 'ALL_ITEMS'
      ? 'Semua Item'
      : mode === 'CATEGORY'
        ? 'Per Kategori'
        : 'Item Tertentu'

  return (
    <div className="rounded-lg border bg-muted/20 p-3.5 space-y-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-lg font-bold tabular-nums">
          {loading ? '...' : itemCount}
        </span>
        <span className="text-sm text-muted-foreground">
          item · {modeLabel}
          {mode === 'CATEGORY' && !loading && categoryCount > 0 && (
            <span className="text-muted-foreground/70"> ({categoryCount} kategori)</span>
          )}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {includeZeroStock ? 'Stok 0 disertakan' : 'Stok 0 tidak disertakan'}
      </div>
      <div className="text-xs text-muted-foreground">
        Snapshot dibuat saat sesi dimulai
      </div>
    </div>
  )
}
