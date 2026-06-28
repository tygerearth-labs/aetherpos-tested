'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
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
/*  Qty per label state helper                                        */
/* ------------------------------------------------------------------ */

function useItemQtyMap() {
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({})

  const getQty = useCallback((key: string) => qtyMap[key] || 1, [qtyMap])

  const setQty = useCallback((key: string, qty: number) => {
    setQtyMap((prev) => {
      const val = Math.max(1, Math.min(999, Math.round(qty) || 1))
      if (val === 1 && !prev[key]) return prev // don't store default
      if (val === 1) {
        const { [key]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [key]: val }
    })
  }, [])

  const resetAll = useCallback(() => setQtyMap({}), [])

  return { getQty, setQty, resetAll }
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
  const [rowsPerLabel, setRowsPerLabel] = useState(2)
  const { getQty, setQty, resetAll } = useItemQtyMap()

  const search = useDebounce(rawSearch, 300)

  /* ---- Fetch ---- */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const totalLabels = printableItems.filter((i) => selectedIds.has(i.key)).reduce((s, i) => s + getQty(i.key), 0)
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

  /* ---- Expanded printable list (qty multiplied) ---- */
  const expandedPrintItems = useMemo(() => {
    const selected = printableItems.filter((i) => selectedIds.has(i.key))
    return selected.flatMap((item) => {
      const qty = getQty(item.key)
      return Array.from({ length: qty }, (_, i) => ({ ...item, _dupIdx: i }))
    })
  }, [printableItems, selectedIds, getQty])

  /* ---- Print ---- */
  const handlePrint = useCallback(async () => {
    const toPrint = expandedPrintItems
    if (toPrint.length === 0) {
      toast.error('Pilih minimal 1 produk untuk dicetak')
      return
    }
    setPrinting(true)
    try {
      const JsBarcodeMod = await import('jsbarcode')
      const JsBarcode = JsBarcodeMod.default || JsBarcodeMod
      const canvas = document.createElement('canvas')

      // Pre-render all barcode images (deduplicated by barcode value)
      const barcodeImgCache: Record<string, string> = {}
      const uniqueBarcodes = [...new Set(toPrint.map((i) => i.barcode))]
      for (const bc of uniqueBarcodes) {
        JsBarcode(canvas, bc, {
          format: 'CODE128',
          width: 2, // render at max res, CSS scales down
          height: 60,
          displayValue: false,
          margin: 0,
          background: '#FFFFFF',
          lineColor: '#000000',
        })
        barcodeImgCache[bc] = canvas.toDataURL('image/png')
      }

      // Build label items as JSON data (passed to preview window)
      const itemsJson = JSON.stringify(toPrint.map((item) => ({
        label: item.parentName ? `${item.parentName} — ${item.label}` : item.label,
        price: formatCurrency(item.price),
        barcode: item.barcode,
        img: barcodeImgCache[item.barcode],
      })))

      const w = window.open('', '_blank', 'width=420,height=640')
      if (!w) { toast.error('Pop-up diblokir. Izinkan pop-up untuk mencetak.'); setPrinting(false); return }
      w.document.write(`<!DOCTYPE html><html><head><title>Cetak ${toPrint.length} Label</title>
<style>
@page{size:80mm auto;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;background:#fff;color:#000;display:flex;flex-direction:column;align-items:center;padding:2mm 0}
.grid{display:grid;grid-template-columns:repeat(var(--cols,2),1fr);width:80mm;gap:0}
.label{padding:var(--pad,2mm 1.5mm);text-align:center;page-break-inside:avoid;overflow:hidden}
.lbl-name{font-size:var(--ns,10px);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:var(--mw,34mm);margin:0 auto 1px}
.lbl-price{font-size:var(--ps,12px);font-weight:700;margin-bottom:2px}
.lbl-img{width:100%;max-width:var(--mw,34mm);height:auto;display:block;margin:0 auto}
.lbl-code{font-size:var(--cs,9px);letter-spacing:1px;margin-top:1px;color:#333}
.bar{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#fff;padding:14px 20px;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.12);display:flex;flex-direction:column;align-items:center;gap:10px}
.bar button{cursor:pointer;border:none;border-radius:8px;font-size:14px;font-weight:600}
.bar .bp{padding:10px 36px;background:#111;color:#fff}
.bar .bc{padding:6px 18px;background:none;color:#888;text-decoration:underline;font-size:13px}
.row-btns{display:flex;gap:6px}
.row-btns button{padding:4px 12px;border-radius:6px;font-size:12px;font-weight:500;border:1px solid #ddd;background:#f5f5f5;color:#666;transition:all .15s}
.row-btns button.active{background:#111;color:#fff;border-color:#111}
.row-btns button:hover:not(.active){background:#eee}
@media print{.bar{display:none!important}}
</style></head><body><div class="grid" id="grid"></div>
<div class="bar">
  <div class="row-btns">
    <button onclick="setCols(2)" id="btn2">2 Baris</button>
    <button onclick="setCols(3)" id="btn3">3 Baris</button>
    <button onclick="setCols(4)" id="btn4">4 Baris</button>
  </div>
  <button class="bp" onclick="window.print()">Cetak ${toPrint.length} Label</button>
  <button class="bc" onclick="window.close()">Tutup</button>
</div>
<script>
const items=${itemsJson};
const presets={2:{ns:'10px',ps:'12px',cs:'9px',pad:'2mm 1.5mm',mw:'34mm'},3:{ns:'8px',ps:'10px',cs:'7px',pad:'1.5mm 1mm',mw:'23mm'},4:{ns:'7px',ps:'9px',cs:'6px',pad:'1mm 0.8mm',mw:'17mm'}};
let cols=${rowsPerLabel};
function render(){
  const g=document.getElementById('grid');
  g.style.setProperty('--cols',cols);
  const p=presets[cols]||presets[2];
  g.style.setProperty('--ns',p.ns);g.style.setProperty('--ps',p.ps);
  g.style.setProperty('--cs',p.cs);g.style.setProperty('--pad',p.pad);
  g.style.setProperty('--mw',p.mw);
  g.innerHTML=items.map(i=>'<div class="label"><div class="lbl-name">'+i.label+'</div><div class="lbl-price">'+i.price+'</div><img class="lbl-img" src="'+i.img+'"/><div class="lbl-code">'+i.barcode+'</div></div>').join('');
  [2,3,4].forEach(n=>{const b=document.getElementById('btn'+n);b.className=n===cols?'active':'';});
}
function setCols(n){cols=n;render();}
render();
</script></body></html>`)
      w.document.close()
    } catch (err) {
      console.error('Batch print error:', err)
      toast.error('Gagal mencetak barcode')
    } finally { setPrinting(false) }
  }, [expandedPrintItems, rowsPerLabel])

  /* ---- Reset everything on close ---- */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) { setRawSearch(''); setFilterCategory(''); setSelectedIds(new Set()); setItems([]); resetAll() }
  }, [open, resetAll])

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
              <span className="ml-1">produk</span>
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
                          {product.variants.filter((v) => v.barcode).map((v) => {
                            const vKey = v.id
                            const vQty = getQty(vKey)
                            const isSelected = selectedIds.has(vKey)
                            return (
                              <div
                                key={v.id}
                                className={cn(
                                  'flex items-center gap-3 px-5 py-2.5 pl-10 hover:bg-white/[0.02] cursor-pointer transition-colors',
                                )}
                                onClick={() => toggleItem(vKey)}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleItem(vKey)}
                                  className="data-[state=checked]:bg-zinc-200 data-[state=checked]:border-zinc-200 data-[state=checked]:text-zinc-900 pointer-events-none"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13px] font-medium text-slate-200 truncate">{v.name}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {v.sku && <span className="text-[10px] font-mono text-zinc-600">{v.sku}</span>}
                                    <span className="text-[11px] text-slate-400 font-medium">{formatCurrency(v.price)}</span>
                                    <span className="text-[10px] text-zinc-600">· Stok {v.stock}</span>
                                  </div>
                                </div>
                                {isSelected && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <span className="text-[10px] text-slate-500">x</span>
                                    <input
                                      type="number"
                                      min={1}
                                      max={999}
                                      value={vQty}
                                      onChange={(e) => setQty(vKey, parseInt(e.target.value) || 1)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-11 h-6 text-[11px] text-center bg-white/[0.06] border border-white/[0.08] rounded text-white focus:outline-none focus:ring-1 focus:ring-white/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                  </div>
                                )}
                                <code className="text-[10px] font-mono text-zinc-600 max-w-[100px] truncate bg-white/[0.03] px-1.5 py-0.5 rounded">
                                  {v.barcode}
                                </code>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    ) : (
                      /* ─── Single product ─── */
                      (() => {
                        const pKey = product.id
                        const pQty = getQty(pKey)
                        const pSelected = selectedIds.has(pKey)
                        return (
                          <div
                            className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/[0.02] cursor-pointer transition-colors"
                            onClick={() => toggleItem(pKey)}
                          >
                            <Checkbox
                              checked={pSelected}
                              onCheckedChange={() => toggleItem(pKey)}
                              className="data-[state=checked]:bg-zinc-200 data-[state=checked]:border-zinc-200 data-[state=checked]:text-zinc-900 pointer-events-none"
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
                            {pSelected && (
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[10px] text-slate-500">x</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={999}
                                  value={pQty}
                                  onChange={(e) => setQty(pKey, parseInt(e.target.value) || 1)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-11 h-6 text-[11px] text-center bg-white/[0.06] border border-white/[0.08] rounded text-white focus:outline-none focus:ring-1 focus:ring-white/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              </div>
                            )}
                            <code className="text-[10px] font-mono text-zinc-600 max-w-[100px] truncate bg-white/[0.03] px-1.5 py-0.5 rounded">
                              {product.barcode}
                            </code>
                          </div>
                        )
                      })()
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
                <span className="text-slate-500 ml-1">produk</span>
                {totalLabels > selectedCount && (
                  <span className="text-slate-500"> · <span className="text-emerald-400 font-semibold tabular-nums">{totalLabels}</span> label</span>
                )}
              </p>
            ) : (
              <p className="text-xs text-zinc-600">Belum ada yang dipilih</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 mr-1">
              {([2, 3, 4] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRowsPerLabel(n)}
                  className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                    rowsPerLabel === n
                      ? 'theme-bg text-white border-transparent font-medium'
                      : 'bg-white/[0.04] border-white/[0.06] text-slate-500 hover:text-slate-300 hover:bg-white/[0.08]'
                  }`}
                >
                  {n} Baris
                </button>
              ))}
            </div>
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
                <><Printer className="mr-1.5 h-3 w-3" /> Cetak {totalLabels > 0 ? `${totalLabels} Label` : 'Barcode'}</>
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
  _dupIdx?: number
}