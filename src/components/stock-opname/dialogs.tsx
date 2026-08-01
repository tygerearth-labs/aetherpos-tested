'use client'

/**
 * Stock Opname V3 dialogs.
 *
 * All dialogs use explicit operational labels — no play/pause icons.
 * The Complete Dialog reads the immutable `completionSummary` from parent
 * state (built BEFORE the API call — never re-derived).
 */

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from '@/components/ui/responsive-dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Camera, AlertTriangle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  fmtQty,
  fmtSignedDelta,
  type OpnameScope,
  type CompletionSummary,
} from './types'

// ════════════════════════════════════════════════════════════
// Start Confirmation Dialog
// ════════════════════════════════════════════════════════════

export function StockOpnameStartDialog({
  open,
  onOpenChange,
  mode,
  itemCount,
  categoryCount,
  includeZeroStock,
  loading,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: OpnameScope
  itemCount: number
  categoryCount: number
  includeZeroStock: boolean
  loading: boolean
  onConfirm: () => void
}) {
  const modeLabel =
    mode === 'ALL_ITEMS'
      ? 'Semua Item'
      : mode === 'CATEGORY'
        ? 'Per Kategori'
        : 'Pilih Item Tertentu'

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Mulai Stock Opname?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Aether akan menyimpan snapshot stok sebagai acuan perbandingan.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="py-2 space-y-3">
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="grid grid-cols-2 text-sm">
              <div className="p-2 bg-muted/40 text-muted-foreground">Mode</div>
              <div className="p-2 font-medium">{modeLabel}</div>
              <div className="p-2 bg-muted/40 text-muted-foreground">Item</div>
              <div className="p-2 font-medium tabular-nums">{itemCount}</div>
              {mode === 'CATEGORY' && (
                <>
                  <div className="p-2 bg-muted/40 text-muted-foreground">Kategori</div>
                  <div className="p-2 font-medium tabular-nums">{categoryCount}</div>
                </>
              )}
              <div className="p-2 bg-muted/40 text-muted-foreground">Item stok 0</div>
              <div className="p-2 font-medium">
                {includeZeroStock ? 'Disertakan' : 'Tidak disertakan'}
              </div>
              <div className="p-2 bg-muted/40 text-muted-foreground">Penyimpanan</div>
              <div className="p-2 font-medium">Perangkat ini</div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Hasil hitung akan tersimpan di perangkat ini sampai sesi diselesaikan.
          </p>

          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Penjualan tetap dapat berjalan. Hindari pembelian, transfer stok, atau
              adjustment manual pada item yang sedang dihitung agar hasil review lebih
              mudah.
            </p>
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Kembali
          </Button>
          <Button onClick={onConfirm} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Camera className="h-4 w-4 mr-2" />
            )}
            Ambil Snapshot &amp; Mulai
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

// ════════════════════════════════════════════════════════════
// Pause (Tunda Sesi) Dialog
// ════════════════════════════════════════════════════════════

export function StockOpnamePauseDialog({
  open,
  onOpenChange,
  countedItems,
  totalItems,
  lastSavedAt,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  countedItems: number
  totalItems: number
  lastSavedAt: string | null
  onConfirm: () => void
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Tunda Stock Opname?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Sesi dapat dilanjutkan kembali kapan saja dari perangkat ini.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="py-2 space-y-3">
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{countedItems}</span> dari{' '}
            <span className="font-semibold tabular-nums">{totalItems}</span> item sudah
            dihitung.
          </p>
          <p className="text-sm text-muted-foreground">
            Semua progres telah tersimpan di perangkat ini.
            {lastSavedAt && ` Terakhir disimpan ${new Date(lastSavedAt).toLocaleTimeString('id-ID')}.`}
          </p>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Kembali Menghitung
          </Button>
          <Button onClick={onConfirm}>
            Tunda Sesi
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

// ════════════════════════════════════════════════════════════
// Cancel (Batalkan Sesi) Dialog
// ════════════════════════════════════════════════════════════

export function StockOpnameCancelDialog({
  open,
  onOpenChange,
  countedItems,
  totalItems,
  lastSavedAt,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  countedItems: number
  totalItems: number
  lastSavedAt: string | null
  onConfirm: () => void
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Batalkan Stock Opname?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Tindakan ini tidak dapat dibatalkan.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="py-2 space-y-3">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              Semua hasil hitung yang belum diselesaikan akan dihapus dari perangkat ini.
            </p>
          </div>
          <div className="text-sm text-muted-foreground space-y-0.5">
            <div>
              Progres: <span className="font-medium text-foreground tabular-nums">{countedItems}</span> /{' '}
              <span className="tabular-nums">{totalItems}</span> item dihitung
            </div>
            {lastSavedAt && (
              <div>
                Terakhir disimpan: {new Date(lastSavedAt).toLocaleString('id-ID')}
              </div>
            )}
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Kembali
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Batalkan Sesi
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

// ════════════════════════════════════════════════════════════
// Complete Dialog — reads immutable completionSummary from parent state
// ════════════════════════════════════════════════════════════

export function StockOpnameCompleteDialog({
  open,
  onOpenChange,
  summary,
  loading,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: CompletionSummary | null
  loading: boolean
  onConfirm: () => void
}) {
  const adjustedItems = summary?.adjustedItems ?? 0

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(open) => {
        if (!loading) onOpenChange(open)
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Selesaikan Stock Opname?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Penyesuaian akan diterapkan ke server. Stok diupdate berdasarkan selisih
            antara hitungan fisik dan snapshot.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {summary && (
          <div className="py-2 space-y-3">
            {/* Immutable summary — read from React state, NEVER re-derived */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-2 text-sm">
                <div className="p-2 bg-muted/40 text-muted-foreground">Item dihitung</div>
                <div className="p-2 font-medium tabular-nums">{summary.countedItems}</div>
                <div className="p-2 bg-muted/40 text-muted-foreground">Item sesuai</div>
                <div className="p-2 font-medium tabular-nums">{summary.matchedItems}</div>
                <div className="p-2 bg-muted/40 text-muted-foreground">Item disesuaikan</div>
                <div className="p-2 font-medium tabular-nums">{summary.adjustedItems}</div>
                <div className="p-2 bg-muted/40 text-muted-foreground">Belum dihitung</div>
                <div className="p-2 font-medium tabular-nums">{summary.uncountedItems}</div>
              </div>
            </div>

            {/* Impact */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                <div className="text-xs text-muted-foreground">Total penambahan</div>
                <div className="text-lg font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                  +{fmtQty(summary.totalPositiveDelta)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <div className="text-xs text-muted-foreground">Total pengurangan</div>
                <div className="text-lg font-bold text-red-600 dark:text-red-400 tabular-nums">
                  −{fmtQty(summary.totalNegativeDelta)}
                </div>
              </div>
            </div>

            {/* Adjusted-items list — Name + SKU + Snapshot→Fisik + Selisih */}
            {summary.adjustments.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 text-xs font-medium text-muted-foreground">
                  Item yang Disesuaikan ({summary.adjustments.length})
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-border">
                  {summary.adjustments.map((adj) => (
                    <div key={adj.snapshotId} className="px-3 py-2 space-y-0.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{adj.itemName}</div>
                          <div className="text-xs text-muted-foreground">
                            {adj.itemSku || 'Tanpa SKU'}
                            {adj.categoryName && ` · ${adj.categoryName}`}
                          </div>
                        </div>
                        <div
                          className={cn(
                            'text-sm font-semibold tabular-nums shrink-0',
                            adj.delta > 0
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-red-600 dark:text-red-400'
                          )}
                        >
                          {fmtSignedDelta(adj.delta)} {adj.itemUnit}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                        <span>Snapshot {fmtQty(adj.systemQty)}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                        <span>Fisik {fmtQty(adj.physicalQty)}</span>
                        <span className="text-muted-foreground/50">·</span>
                        <span>{adj.itemUnit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Partial-completion warning */}
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Hanya item yang sudah dihitung yang akan diproses.{' '}
                {summary.uncountedItems > 0 && (
                  <span className="font-medium">
                    {summary.uncountedItems} item belum dihitung
                  </span>
                )}{' '}
                tidak akan diubah.
              </p>
            </div>
          </div>
        )}

        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Kembali ke Review
          </Button>
          <Button onClick={onConfirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {adjustedItems > 0
              ? `Terapkan ${adjustedItems} Penyesuaian`
              : 'Selesaikan Tanpa Penyesuaian'}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
