'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { Printer } from 'lucide-react'

interface BarcodeDisplayProps {
  value: string
  width?: number
  height?: number
  displayValue?: boolean
  className?: string
  fontSize?: number
  margin?: number
  /** Show print button below barcode */
  showPrint?: boolean
  /** Product name shown on print label */
  label?: string
  /** Price shown on print label */
  priceLabel?: string
}

export default function BarcodeDisplay({
  value,
  width = 2,
  height = 60,
  displayValue = true,
  className = '',
  fontSize = 12,
  margin = 4,
  showPrint = false,
  label = '',
  priceLabel = '',
}: BarcodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)

  // Render barcode onto canvas using JsBarcode
  useEffect(() => {
    if (!canvasRef.current || !value) return

    let cancelled = false
    setError(null)

    // Dynamic import to avoid SSR issues
    import('jsbarcode')
      .then((mod) => {
        if (cancelled) return
        const JsBarcode = mod.default || mod
        try {
          JsBarcode(canvasRef.current!, value, {
            format: 'CODE128',
            width,
            height,
            displayValue,
            fontSize,
            margin,
            background: '#FFFFFF',
            lineColor: '#000000',
            font: 'monospace',
            textMargin: 4,
          })
        } catch (err) {
          if (!cancelled) {
            console.error('[BarcodeDisplay] JsBarcode render error:', err)
            setError('Gagal render barcode')
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[BarcodeDisplay] Failed to load JsBarcode:', err)
          setError('Library barcode tidak tersedia')
        }
      })

    return () => {
      cancelled = true
    }
  }, [value, width, height, displayValue, fontSize, margin])

  const handlePrint = useCallback(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const dataUrl = canvas.toDataURL('image/png')

    const printWindow = window.open('', '_blank', 'width=400,height=300')
    if (!printWindow) return

    printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
  <title>Barcode - ${value}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      min-height: 100vh;
      font-family: 'Courier New', monospace;
      background: #fff;
      color: #000;
    }
    .label {
      width: 76mm;
      padding: 2mm;
      text-align: center;
    }
    .product-name {
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 72mm;
    }
    .product-price {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .barcode-img {
      width: 100%;
      max-width: 72mm;
      height: auto;
    }
    .barcode-text {
      font-size: 11px;
      letter-spacing: 2px;
      margin-top: 2px;
    }
    @media print {
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="label">
    ${label ? `<div class="product-name">${label}</div>` : ''}
    ${priceLabel ? `<div class="product-price">${priceLabel}</div>` : ''}
    <img class="barcode-img" src="${dataUrl}" alt="barcode" />
    <div class="barcode-text">${value}</div>
  </div>
  <div class="no-print" style="margin-top:16px;text-align:center;">
    <button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;border:1px solid #ccc;border-radius:6px;background:#111;color:#fff;">
      Cetak Sekarang
    </button>
    <br/>
    <button onclick="window.close()" style="margin-top:8px;padding:8px 20px;font-size:13px;cursor:pointer;border:none;background:none;color:#888;text-decoration:underline;">
      Tutup
    </button>
  </div>
</body>
</html>
`)
    printWindow.document.close()
  }, [value, label, priceLabel])

  if (!value) return null

  // Error state: show text fallback
  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center ${className}`}>
        <div className="bg-zinc-100 border border-zinc-200 rounded px-3 py-2">
          <p className="text-zinc-500 text-xs text-center">{error}</p>
          <p className="text-zinc-700 text-sm font-mono font-bold text-center mt-1">{value}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <canvas ref={canvasRef} />
      {showPrint && (
        <button
          type="button"
          onClick={handlePrint}
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
        >
          <Printer className="h-2.5 w-2.5" />
          Cetak Barcode
        </button>
      )}
    </div>
  )
}

// Re-export a tiny print-only helper so other components can trigger print
export function printBarcodeFromDataUrl(dataUrl: string, value: string, label?: string, priceLabel?: string) {
  const printWindow = window.open('', '_blank', 'width=400,height=300')
  if (!printWindow) return

  printWindow.document.write(`
<!DOCTYPE html>
<html><head><title>Barcode - ${value}</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { display:flex; flex-direction:column; align-items:center; justify-content:flex-start; min-height:100vh; font-family:'Courier New',monospace; background:#fff; color:#000; }
.label { width:76mm; padding:2mm; text-align:center; }
.product-name { font-size:13px; font-weight:bold; margin-bottom:2px; }
.product-price { font-size:14px; font-weight:bold; margin-bottom:4px; }
.barcode-img { width:100%; max-width:72mm; height:auto; }
.barcode-text { font-size:11px; letter-spacing:2px; margin-top:2px; }
@media print { .no-print { display:none !important; } }
</style></head>
<body>
<div class="label">
  ${label ? `<div class="product-name">${label}</div>` : ''}
  ${priceLabel ? `<div class="product-price">${priceLabel}</div>` : ''}
  <img class="barcode-img" src="${dataUrl}" alt="barcode" />
  <div class="barcode-text">${value}</div>
</div>
<div class="no-print" style="margin-top:16px;text-align:center;">
  <button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;border:1px solid #ccc;border-radius:6px;background:#111;color:#fff;">Cetak Sekarang</button>
  <br/><button onclick="window.close()" style="margin-top:8px;padding:8px 20px;font-size:13px;cursor:pointer;border:none;background:none;color:#888;text-decoration:underline;">Tutup</button>
</div>
</body></html>`)
  printWindow.document.close()
}