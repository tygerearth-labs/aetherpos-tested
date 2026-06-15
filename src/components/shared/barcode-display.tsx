'use client'

import { useEffect, useRef } from 'react'

interface BarcodeDisplayProps {
  value: string
  width?: number
  height?: number
  displayValue?: boolean
  className?: string
  fontSize?: number
  margin?: number
}

export default function BarcodeDisplay({
  value,
  width = 2,
  height = 60,
  displayValue = true,
  className = '',
  fontSize = 12,
  margin = 4,
}: BarcodeDisplayProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        // Dynamic import to avoid SSR issues
        import('jsbarcode').then((JsBarcode) => {
          const defaultExport = JsBarcode.default || JsBarcode
          defaultExport(svgRef.current!, value, {
            format: 'CODE128',
            width,
            height,
            displayValue,
            fontSize,
            margin,
            background: 'transparent',
            lineColor: '#e4e4e7', // zinc-200
            font: 'monospace',
            textMargin: 4,
          })
        }).catch(() => {
          // Silently fail if JsBarcode can't load
        })
      } catch {
        // Ignore
      }
    }
  }, [value, width, height, displayValue, fontSize, margin])

  if (!value) return null

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <svg ref={svgRef} />
    </div>
  )
}