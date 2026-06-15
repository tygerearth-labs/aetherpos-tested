'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from '@/components/ui/responsive-dialog'
import { Loader2, Search, Printer, CheckSquare, Square } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { toast } from 'sonner'

interface BarcodeItem {
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

export default function BatchBarcodeDialog({ open, onOpenChange, categories }: BatchBarcodeDialogProps) {
  const [items, setItems] = useState<BarcodeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [printing, setPrinting] = useState(false)

  // Fetch products
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    if (filterCategory) params.set('categoryId', filterCategory)
    if (search.trim()) params.set('search', search.trim())
    fetch(`/api/products/barcodes?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setItems(data)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [open, filterCategory, search])

  // Build flat list of printable items (product or variant)
  const printableItems = items.flatMap((p) => {
    if (p.hasVariants && p.variants.length > 0) {
      return p.variants.map((v) => ({
        key: v.id,
        label: `${p.name} — ${v.name}`,
        barcode: v.barcode,
        price: v.price,
      }))
    }
    return [{
      key: p.id,
      label: p.name,
      barcode: p.barcode,
      price: p.price,
    }]
  }).filter((item) => item.barcode) // only items with barcode

  const selectedCount = printableItems.filter((i) => selectedIds.has(i.key)).length

  const toggleAll = useCallback(() => {
    if (selectedCount === printableItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(printableItems.map((i) => i.key)))
    }
  }, [selectedCount, printableItems])

  const toggleItem = useCallback((key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handlePrint = useCallback(async () => {
    const toPrint = printableItems.filter((i) => selectedIds.has(i.key))
    if (toPrint.length === 0) {
      toast.error('Pilih minimal 1 produk untuk dicetak')
      return
    }

    setPrinting(true)
    try {
      // Dynamically import JsBarcode
      const JsBarcodeMod = await import('jsbarcode')
      const JsBarcode = JsBarcodeMod.default || JsBarcodeMod

      // Create a temporary canvas to render each barcode
      const tempCanvas = document.createElement('canvas')
      const barcodeImages: Array<{ label: string; price: string; dataUrl: string; barcodeText: string }> = []

      for (const item of toPrint) {
        if (!item.barcode) continue
        JsBarcode(tempCanvas, item.barcode, {
          format: 'CODE128',
          width: 2,
          height: 50,
          displayValue: false,
          margin: 0,
          background: '#FFFFFF',
          lineColor: '#000000',
        })
        const dataUrl = tempCanvas.toDataURL('image/png')
        barcodeImages.push({
          label: item.label,
          price: formatCurrency(item.price),
          dataUrl,
          barcodeText: item.barcode,
        })
      }

      // Build print page
      const labelsHtml = barcodeImages.map((b) => `
        <div class="label">
          <div class="product-name">${b.label}</div>
          <div class="product-price">${b.price}</div>
          <img class="barcode-img" src="${b.dataUrl}" alt="barcode" />
          <div class="barcode-text">${b.barcodeText}</div>
        </div>
      `).join('\n')

      const printWindow = window.open('', '_blank', 'width=400,height=600')
      if (!printWindow) {
        toast.error('Pop-up diblokir. Izinkan pop-up untuk mencetak.')
        setPrinting(false)
        return
      }

      printWindow.document.write(`<!DOCTYPE html>
<html><head><title>Cetak Barcode (${barcodeImages.length} label)</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Courier New', monospace;
  background: #fff; color: #000;
  display: flex; flex-direction: column; align-items: center;
}
.label {
  width: 76mm; padding: 3mm 2mm; text-align: center;
  border-bottom: 1px dashed #ccc; page-break-inside: avoid;
}
.product-name { font-size: 12px; font-weight: bold; margin-bottom: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 72mm; }
.product-price { font-size: 13px; font-weight: bold; margin-bottom: 3px; }
.barcode-img { width: 100%; max-width: 72mm; height: auto; }
.barcode-text { font-size: 10px; letter-spacing: 2px; margin-top: 2px; }
.no-print { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); text-align: center; background: #fff; padding: 12px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.15); }
@media print {
  .no-print { display: none !important; }
  .label { border-bottom: none; }
}
</style></head>
<body>
${labelsHtml}
<div class="no-print">
  <button onclick="window.print()" style="padding:12px 32px;font-size:14px;cursor:pointer;border:none;border-radius:8px;background:#111;color:#fff;font-weight:600;">
    Cetak ${barcodeImages.length} Label
  </button>
  <br/>
  <button onclick="window.close()" style="margin-top:8px;padding:8px 20px;font-size:13px;cursor:pointer;border:none;background:none;color:#888;text-decoration:underline;">
    Tutup
  </button>
</div>
</body></html>`)
      printWindow.document.close()
    } catch (err) {
      console.error('Batch print error:', err)
      toast.error('Gagal mencetak barcode')
    } finally {
      setPrinting(false)
    }
  }, [printableItems, selectedIds])

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSearch('')
      setFilterCategory('')
      setSelectedIds(new Set())
      setItems([])
    }
  }, [open])

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <ResponsiveDialogHeader className="px-5 pt-5 pb-3">
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Printer className="h-4 w-4" />
            Cetak Barcode Massal
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Pilih produk yang ingin dicetak barcodenya. Label akan diformat untuk printer thermal 80mm.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {/* Search & Filter */}
        <div className="px-5 pb-3 space-y-2 border-b border-zinc-800">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
              <Input
                placeholder="Cari produk atau SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm bg-zinc-900 border-zinc-800 text-zinc-100"
              />
            </div>
          </div>
          {/* Category filters */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setFilterCategory('')}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${!filterCategory ? 'bg-zinc-100 text-zinc-900 border-zinc-300' : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'}`}
            >
              Semua
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setFilterCategory(c.id)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${filterCategory === c.id ? 'bg-zinc-100 text-zinc-900 border-zinc-300' : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Select All + Count */}
        <div className="px-5 py-2.5 flex items-center justify-between border-b border-zinc-800/50 bg-zinc-900/30">
          <button
            type="button"
            onClick={toggleAll}
            className="flex items-center gap-2 text-xs text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            {selectedCount === printableItems.length && printableItems.length > 0 ? (
              <CheckSquare className="h-4 w-4 text-emerald-400" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            {selectedCount === printableItems.length ? 'Batal Semua' : 'Pilih Semua'}
          </button>
          <span className="text-[11px] text-zinc-500">
            {selectedCount}/{printableItems.length} label dipilih
          </span>
        </div>

        {/* Product List */}
        <ScrollArea className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
              <span className="ml-2 text-sm text-zinc-500">Memuat produk...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <p className="text-sm">Tidak ada produk ditemukan</p>
            </div>
          ) : (
            <div className="py-1">
              {items.map((product) => {
                const hasBarcode = !!(product.barcode || (product.hasVariants && product.variants.some((v) => v.barcode)))
                if (!hasBarcode) return null // skip products without barcode

                return (
                  <div key={product.id} className="border-b border-zinc-800/30 last:border-0">
                    {/* Product row (non-variant) or header (variant) */}
                    {!product.hasVariants || product.variants.length === 0 ? (
                      <label className="flex items-center gap-3 px-5 py-2.5 hover:bg-zinc-800/20 cursor-pointer transition-colors">
                        <Checkbox
                          checked={selectedIds.has(product.id)}
                          onCheckedChange={() => toggleItem(product.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-200 truncate">{product.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {product.sku && <span className="text-[10px] font-mono text-zinc-500">{product.sku}</span>}
                            <span className="text-[10px] text-zinc-400">{formatCurrency(product.price)}</span>
                            {product.category && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-zinc-700 text-zinc-500">
                                {product.category.name}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-600 max-w-[120px] truncate">
                          {product.barcode}
                        </span>
                      </label>
                    ) : (
                      <>
                        {/* Variant product header */}
                        <div className="flex items-center gap-3 px-5 py-2 bg-zinc-800/10">
                          <div className="w-4 h-4" />
                          <p className="text-xs font-semibold text-zinc-400 truncate">{product.name}</p>
                          {product.category && (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-zinc-700 text-zinc-500">
                              {product.category.name}
                            </Badge>
                          )}
                        </div>
                        {product.variants.filter((v) => v.barcode).map((variant) => (
                          <label
                            key={variant.id}
                            className="flex items-center gap-3 pl-9 pr-5 py-2 hover:bg-zinc-800/20 cursor-pointer transition-colors"
                          >
                            <Checkbox
                              checked={selectedIds.has(variant.id)}
                              onCheckedChange={() => toggleItem(variant.id)}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-zinc-200 truncate">{variant.name}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {variant.sku && <span className="text-[10px] font-mono text-zinc-500">{variant.sku}</span>}
                                <span className="text-[10px] text-zinc-400">{formatCurrency(variant.price)}</span>
                              </div>
                            </div>
                            <span className="text-[10px] font-mono text-zinc-600 max-w-[120px] truncate">
                              {variant.barcode}
                            </span>
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <ResponsiveDialogFooter className="px-5 py-4 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-xs text-zinc-500">
            {selectedCount > 0 ? (
              <><span className="text-zinc-300 font-medium">{selectedCount}</span> label siap cetak</>
            ) : (
              'Belum ada yang dipilih'
            )}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-9 text-xs border-zinc-700 text-zinc-300 hover:text-zinc-100"
            >
              Tutup
            </Button>
            <Button
              onClick={handlePrint}
              disabled={selectedCount === 0 || printing}
              className="h-9 text-xs bg-zinc-100 text-zinc-900 hover:bg-zinc-200 font-medium"
            >
              {printing ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Membuat Label...</>
              ) : (
                <><Printer className="mr-1.5 h-3.5 w-3.5" /> Cetak {selectedCount > 0 ? `${selectedCount} Label` : 'Barcode'}</>
              )}
            </Button>
          </div>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}