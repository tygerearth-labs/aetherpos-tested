'use client'

/**
 * StockOpnameQuickCountWidget — V3 compact focused counting widget.
 *
 * Replaces the V2 oversized editor + three rigid information blocks with a
 * single compact widget:
 *
 *   ┌─────────────────────────────────────────┐
 *   │ Item Name                    [×]         │
 *   │ SKU · Category                           │
 *   ├─────────────────────────────────────────┤
 *   │ Snapshot 8 pcs → Fisik 5 pcs → Selisih −3│
 *   ├─────────────────────────────────────────┤
 *   │ Jumlah Fisik                             │
 *   │   [−]  [  5  ]  [+]                      │
 *   │   Stok akan dikurangi 3 pcs              │
 *   ├─────────────────────────────────────────┤
 *   │  [Lewati]        [Simpan & Item Berikut] │
 *   └─────────────────────────────────────────┘
 *
 * Keyboard:
 *   Enter       — save & next
 *   Escape      — close widget
 *   ArrowUp     — +1
 *   ArrowDown   — −1
 *   Shift+Up    — +10
 *   Shift+Down  — −10
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, Minus, Plus, CheckCircle2, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  VARIANCE_EPSILON,
  fmtQty,
  fmtSignedDelta,
  type SnapshotItem,
} from './types'

export function StockOpnameQuickCountWidget({
  snapshot,
  onSave,
  onSkip,
  onClose,
  onNext, // optional: select next uncounted item
}: {
  snapshot: SnapshotItem
  onSave: (snapshotId: string, qty: number) => void
  onSkip: () => void
  onClose: () => void
  onNext?: () => void
}) {
  // Initialize from snapshot. The parent uses `key={snapshot.id}` to force a
  // remount when the snapshot changes, so this initializer runs fresh each
  // time — no useEffect+setState needed.
  const [value, setValue] = useState<string>(
    snapshot.physicalQty !== null ? fmtQty(snapshot.physicalQty) : ''
  )
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input on mount only (DOM side-effect, not setState)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const numericValue = value === '' ? null : parseFloat(value)
  const snapshotQty = snapshot.systemQty
  const diff = numericValue === null ? 0 : numericValue - snapshotQty
  const isMatch = numericValue !== null && Math.abs(diff) < VARIANCE_EPSILON
  const isDiff = numericValue !== null && Math.abs(diff) >= VARIANCE_EPSILON

  const step = useCallback(
    (delta: number) => {
      const current = numericValue === null || isNaN(numericValue) ? 0 : numericValue
      const next = Math.max(0, Math.round((current + delta) * 1000) / 1000)
      setValue(String(next))
    },
    [numericValue]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(e.shiftKey ? 10 : 1)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(e.shiftKey ? -10 : -1)
      return
    }
  }

  const handleSave = () => {
    if (numericValue === null || isNaN(numericValue) || numericValue < 0) {
      // Invalid — don't save, keep focus
      inputRef.current?.focus()
      return
    }
    onSave(snapshot.id, numericValue)
    // After save, try to advance to next uncounted item
    if (onNext) {
      onNext()
    }
  }

  // Live result text
  const resultText = (() => {
    if (numericValue === null) return null
    if (isMatch) {
      return (
        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Stok sesuai
        </span>
      )
    }
    const abs = fmtQty(Math.abs(diff))
    const unit = snapshot.itemUnit
    if (diff > 0) {
      return (
        <span className="text-blue-600 dark:text-blue-400">
          Stok akan ditambah {abs} {unit}
        </span>
      )
    }
    return (
      <span className="text-red-600 dark:text-red-400">
        Stok akan dikurangi {abs} {unit}
      </span>
    )
  })()

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
    >
      <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-3 border-b border-amber-500/20">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{snapshot.itemName}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {snapshot.itemSku || 'Tanpa SKU'}
              {snapshot.categoryName && ` · ${snapshot.categoryName}`}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Compact flow row: Snapshot → Fisik → Selisih */}
        <div className="px-3 py-2 flex items-center justify-center gap-2 text-sm border-b border-amber-500/20 bg-background/50">
          <span className="text-muted-foreground">
            Snapshot{' '}
            <span className="font-semibold text-foreground tabular-nums">
              {fmtQty(snapshotQty)}
            </span>{' '}
            {snapshot.itemUnit}
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
          <span className="text-muted-foreground">
            Fisik{' '}
            <span
              className={cn(
                'font-semibold tabular-nums',
                numericValue === null
                  ? 'text-muted-foreground'
                  : 'text-foreground'
              )}
            >
              {numericValue === null ? '—' : fmtQty(numericValue)}
            </span>
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
          <span className="text-muted-foreground">
            Selisih{' '}
            <span
              className={cn(
                'font-semibold tabular-nums',
                numericValue === null
                  ? 'text-muted-foreground'
                  : isMatch
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : diff > 0
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-red-600 dark:text-red-400'
              )}
            >
              {numericValue === null ? '—' : fmtSignedDelta(diff)}
            </span>
          </span>
        </div>

        {/* Physical quantity control */}
        <div className="p-3 space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Jumlah Fisik
          </label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => step(-1)}
              type="button"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              ref={inputRef}
              type="number"
              step="0.001"
              min="0"
              placeholder="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-11 text-center text-lg font-semibold tabular-nums"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => step(1)}
              type="button"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Live result */}
          <div className="text-xs h-4 flex items-center">
            {resultText}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 p-3 pt-0">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={onSkip}
            type="button"
          >
            Lewati
          </Button>
          <Button
            className="flex-[2]"
            onClick={handleSave}
            disabled={numericValue === null || isNaN(numericValue) || numericValue < 0}
            type="button"
          >
            Simpan & Item Berikut
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
