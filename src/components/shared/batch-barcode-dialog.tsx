'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from '@/components/ui/responsive-dialog'
import { Loader2, Search, Printer, CheckSquare, Square, PackageOpen } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { toast } from 'sonner'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BarcodeProduct {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  price: number
  category: { id: string; name: string } | null
  hasVariants: boolean
  variants: Array<{
    id: string
    name: string
    sku: string | null
    barcode: string | null
    price: number
    stock: number
  }>
}

interface BatchBarcodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Array<{ id: string; name: string; color: string }>
}

/* ------------------------------------------------------------------ */
/*  Debounce hook                                                      */
/* ------------------------------------------------------------------ */

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BatchBarcodeDialog({ open, onOpenChange, categories }: BatchBarcodeDialogProps) {
  const [items, setItems] = useState<BarcodeProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [rawSearch, setRawSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [printing, setPrinting] = useState(false)

  const search = useDebounce(rawSearch, 300)

  /* ---- Fetch ---- */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    if (filterCategory) params.set('categoryId', filterCategory)
    if (search) params.set('search', search)
    fetch(`/api/products/barcodes?${params}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: BarcodeProduct[]) => {
        if (!cancelled && Array.isArray(data)) setItems(data)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, filterCategory, search])

  /* ---- Reset selection when filter / search changes ---- */
  useEffect(() => {
    if (open) setSelectedIds(new Set())
  }, [open, filterCategory, search])

  /* ---- Derive printable flat list ---- */
  const printableItems = useMemo(() =>
    items.flatMap<PrintableItem>((p) => {
      if (p.hasVariants && p.variants.length > 0) {
        return p.variants
          .filter((v) => v.barcode)
          .map((v) => ({
            key: v.id,
            label: v.name,
            parentName: p.name,
            barcode: v.barcode!,
            price: v.price,
            sku: v.sku,
            categoryId: p.category?.id ?? '',
          }))
      }
      if (!p.barcode) return []
      return [{
        key: p.id,
        label: p.name,
        parentName: '',
        barcode: p.barcode,
        price: p.price,
        sku: p.sku,
        categoryId: p.category?.id ?? '',
      }]
    }),
    [items],
  )

  const selectedCount = printableItems.filter((i) => selectedIds.has(i.key)).length
  const allSelected = printableItems.length > 0 && selectedCount === printableItems.length

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (allSelected) return new Set<string>()
      const next = new Set(prev)
      for (const i of printableItems) next.add(i.key)
      return next
    })
  }, [allSelected, printableItems])

  const toggleItem = useCallback((key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /* ---- Print ---- */
  const handlePrint = useCallback(async () => {
    const toPrint = printableItems.filter((i) => selectedIds.has(i.key))
    if (toPrint.length === 0) {
      toast.error('Pilih minimal 1 produk untuk dicetak')
      return
    }
    setPrinting(true)
    try {
      const JsBarcodeMod = await import('jsbarcode')
      const JsBarcode = JsBarcodeMod.default || JsBarcodeMod
      const canvas = document.createElement('canvas')
      const labels: string[] = []

      for (const item of toPrint) {
        JsBarcode(canvas, item.barcode, {
          format: 'CODE128',
          width: 2,
          height: 50,
          displayValue: false,
          margin: 0,
          background: '#FFFFFF',
          lineColor: '#000000',
        })
        const src = canvas.toDataURL('image/png')
        labels.push(`
          <div class="label">
            <div class="lbl-name">${item.parentName ? `${item.parentName} — ${item.label}` : item.label}</div>
            <div class="lbl-price">${formatCurrency(item.price)}</div>
            <img class="lbl-img" src="${src}" />
            <div class="lbl-code">${item.barcode}</div>
          </div>`)
      }

      const w = window.open('', '_blank', 'width=420,height=640')
      if (!w) { toast.error('Pop-up diblokir. Izinkan pop-up untuk mencetak.'); setPrinting(false); return }
      w.document.write(`<!DOCTYPE html><html><head><title>Cetak ${toPrint.length} Label</title>
<style>
@page{size:80mm auto;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;background:#fff;color:#000;display:flex;flex-direction:column;align-items:center;padding:4mm 0}
.label{width:72mm;padding:2.5mm 2mm;text-align:center;page-break-inside:avoid}
.lbl-name{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68mm;margin:0 auto 1px}
.lbl-price{font-size:14px;font-weight:700;margin-bottom:3px}
.lbl-img{width:100%;max-width:68mm;height:auto;display:block;margin:0 auto}
.lbl-code{font-size:10px;letter-spacing:1.5px;margin-top:2px;color:#333}
.bar{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#fff;padding:14px 20px;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.12);display:flex;flex-direction:column;align-items:center;gap:8px}
.bar button{cursor:pointer;border:none;border-radius:8px;font-size:14px;font-weight:600}
.bar .bp{padding:10px 36px;background:#111;color:#fff}
.bar .bc{padding:6px 18px;background:none;color:#888;text-decoration:underline;font-size:13px}
@media print{.bar{display:none!important}}
</style></head><body>${labels.join('')}
<div class="bar">
  <button class="bp" onclick="window.print()">Cetak ${toPrint.length} Label</button>
  <button class="bc" onclick="window.close()">Tutup</button>
</div></body></html>`)
      w.document.close()
    } catch (err) {
      console.error('Batch print error:', err)
      toast.error('Gagal mencetak barcode')
    } finally { setPrinting(false) }
  }, [printableItems, selectedIds])

  /* ---- Reset everything on close ---- */
  useEffect(() => {
    if (!open) { setRawSearch(''); setFilterCategory(''); setSelectedIds(new Set()); setItems([]) }
  }, [open])

  /* ---- Filtered items for rendering (products with barcode) ---- */
  const visibleItems = items.filter((p) =>
    !!(p.barcode || (p.hasVariants && p.variants.some((v) => v.barcode)))
  )

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      {/* overflow-hidden critical: lets internal ScrollArea control scrolling */}
      <ResponsiveDialogContent
        className="sm:max-w-2xl !max-h-[85vh] flex flex-col !overflow-hidden p-0 gap-0"
      >
        {/* ── Header ── */}
        <ResponsiveDialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <ResponsiveDialogTitle className="flex items-center gap-2 text-base">
            <Printer className="h-4 w-4" />
            Cetak Barcode Massal
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-xs">
            Pilih produk, lalu cetak semua label sekaligus untuk printer thermal 80mm.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {/* ── Search ── */}
        <div className="px-5 pb-3 shrink-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <Input
              placeholder="Cari produk atau SKU..."
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              className="pl-9 h-9 text-sm bg-nebula border-white/[0.06] text-white placeholder:text-zinc-600 focus-visible:ring-zinc-700"
            />
          </div>
        </div>

        {/* ── Category Pills + Select All (sticky sub-header) ── */}
        <div className="px-5 pb-2.5 shrink-0 border-b border-white/[0.06] space-y-2.5">
          {categories.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setFilterCategory('')}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  !filterCategory
                    ? 'bg-zinc-100 text-zinc-900 border-zinc-300 font-medium'
                    : 'bg-white/[0.04] text-slate-400 border-zinc-700/60 hover:text-slate-200 hover:border-zinc-600'
                }`}
              >
                Semua
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setFilterCategory(c.id)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    filterCategory === c.id
                      ? 'bg-zinc-100 text-zinc-900 border-zinc-300 font-medium'
                      : 'bg-white/[0.04] text-slate-400 border-zinc-700/60 hover:text-slate-200 hover:border-zinc-600'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {/* Select all bar */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              {allSelected ? (
                <CheckSquare className="h-4 w-4 text-emerald-400" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {allSelected ? 'Batal Semua' : 'Pilih Semua'}
            </button>
            <span className="text-[11px] tabular-nums text-slate-500">
              <span className={selectedCount > 0 ? 'text-slate-200 font-medium' : ''}>{selectedCount}</span>
              <span className="text-zinc-600"> / {printableItems.length}</span>
              <span className="ml-1">label</span>
            </span>
          </div>
        </div>

        {/* ── Scrollable Product List ── */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
              <span className="text-xs text-slate-500">Memuat produk…</span>
            </div>
          ) : !loading && visibleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-500">
              <PackageOpen className="h-8 w-8 text-zinc-700" />
              <div className="text-center">
                <p className="text-sm font-medium text-slate-400">Tidak ada produk dengan barcode</p>
                <p className="text-[11px] text-zinc-600 mt-1">
                  {items.length > 0
                    ? `${items.length} produk ditemukan tapi tidak memiliki barcode.`
                    : 'Coba ubah filter atau kata kunci pencarian.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {visibleItems.map((product) => {
                const isVariant = product.hasVariants && product.variants.length > 0
                return (
                  <div key={product.id}>
                    {isVariant ? (
                      /* ─── Variant group ─── */
                      <>
                        <div className="flex items-center gap-2 px-5 py-2 bg-white/[0.02]">
                          <div className="w-[18px] shrink-0" />
                          <p className="text-xs font-semibold text-slate-400 truncate">{product.name}</p>
                          {product.category && (
                            <span className="text-[9px] text-zinc-600 bg-white/[0.04] px-1.5 py-0.5 rounded">
                              {product.category.name}
                            </span>
                          )}
                        </div>
                        <div className="divide-y divide-white/[0.02]">
                          {product.variants.filter((v) => v.barcode).map((v) => (
                            <label
                              key={v.id}
                              className="flex items-center gap-3 px-5 py-2.5 pl-10 hover:bg-white/[0.02] cursor-pointer transition-colors"
                            >
                              <Checkbox
                                checked={selectedIds.has(v.id)}
                                onCheckedChange={() => toggleItem(v.id)}
                                className="data-[state=checked]:bg-zinc-200 data-[state=checked]:border-zinc-200 data-[state=checked]:text-zinc-900"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-medium text-slate-200 truncate">{v.name}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {v.sku && <span className="text-[10px] font-mono text-zinc-600">{v.sku}</span>}
                                  <span className="text-[11px] text-slate-400 font-medium">{formatCurrency(v.price)}</span>
                                  <span className="text-[10px] text-zinc-600">· Stok {v.stock}</span>
                                </div>
                              </div>
                              <code className="text-[10px] font-mono text-zinc-600 max-w-[110px] truncate bg-white/[0.03] px-1.5 py-0.5 rounded">
                                {v.barcode}
                              </code>
                            </label>
                          ))}
                        </div>
                      </>
                    ) : (
                      /* ─── Single product ─── */
                      <label className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/[0.02] cursor-pointer transition-colors">
                        <Checkbox
                          checked={selectedIds.has(product.id)}
                          onCheckedChange={() => toggleItem(product.id)}
                          className="data-[state=checked]:bg-zinc-200 data-[state=checked]:border-zinc-200 data-[state=checked]:text-zinc-900"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-slate-200 truncate">{product.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {product.sku && <span className="text-[10px] font-mono text-zinc-600">{product.sku}</span>}
                            <span className="text-[11px] text-slate-400 font-medium">{formatCurrency(product.price)}</span>
                            {product.category && (
                              <span className="text-[9px] text-zinc-600 bg-white/[0.04] px-1.5 py-0.5 rounded">
                                {product.category.name}
                              </span>
                            )}
                          </div>
                        </div>
                        <code className="text-[10px] font-mono text-zinc-600 max-w-[110px] truncate bg-white/[0.03] px-1.5 py-0.5 rounded">
                          {product.barcode}
                        </code>
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 px-5 py-3.5 border-t border-white/[0.06] bg-nebula flex items-center justify-between gap-3">
          <div className="min-w-0">
            {selectedCount > 0 ? (
              <p className="text-xs text-slate-300">
                <span className="font-semibold tabular-nums">{selectedCount}</span>
                <span className="text-slate-500 ml-1">label siap cetak</span>
              </p>
            ) : (
              <p className="text-xs text-zinc-600">Belum ada yang dipilih</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 text-xs border-zinc-700 text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"
            >
              Tutup
            </Button>
            <Button
              size="sm"
              onClick={handlePrint}
              disabled={selectedCount === 0 || printing}
              className="h-8 text-xs bg-zinc-100 text-zinc-900 hover:bg-white font-semibold disabled:opacity-40"
            >
              {printing ? (
                <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Membuat…</>
              ) : (
                <><Printer className="mr-1.5 h-3 w-3" /> Cetak {selectedCount > 0 ? `${selectedCount} Label` : 'Barcode'}</>
              )}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

/* ------------------------------------------------------------------ */
/*  Local type                                                         */
/* ------------------------------------------------------------------ */
interface PrintableItem {
  key: string
  label: string
  parentName: string
  barcode: string
  price: number
  sku: string | null
  categoryId: string
}