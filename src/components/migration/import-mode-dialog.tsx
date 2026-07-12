'use client'

import { motion } from 'framer-motion'
import { Star, Package, Check, Zap, BookOpen, BarChart3, FileText, Boxes } from 'lucide-react'
import type { ImportMode } from './migration-banner'

interface ImportModeDialogProps {
  selected: ImportMode
  onSelect: (mode: ImportMode) => void
}

const modes: {
  id: ImportMode
  title: string
  subtitle: string
  recommended?: boolean
  description: string
  features: { icon: React.ElementType; label: string }[]
  note: string
}[] = [
  {
    id: 'product_only',
    title: 'Langsung Siap Jual',
    subtitle: 'Direkomendasikan',
    recommended: true,
    description: 'Import sebagai Produk. Cocok untuk pengguna yang ingin segera mulai berjualan.',
    features: [
      { icon: Package, label: 'Produk' },
      { icon: FileText, label: 'SKU' },
      { icon: BarChart3, label: 'Barcode' },
      { icon: Zap, label: 'Harga Jual' },
      { icon: BookOpen, label: 'Kategori' },
    ],
    note: 'Purchase, Audit Stock, dan Inventory dapat diaktifkan kapan saja.',
  },
  {
    id: 'product_inventory',
    title: 'Kelola Inventory',
    subtitle: null,
    recommended: false,
    description: 'Import sebagai Produk + Inventory. Direkomendasikan jika Anda ingin langsung menggunakan:',
    features: [
      { icon: Package, label: 'Purchase' },
      { icon: Boxes, label: 'Audit Stock' },
      { icon: FileText, label: 'Komposisi Produk' },
      { icon: BarChart3, label: 'Perhitungan HPP' },
      { icon: BookOpen, label: 'Manajemen Inventory' },
    ],
    note: 'Stok awal akan otomatis menjadi saldo awal inventory.',
  },
]

export function ImportModeDialog({ selected, onSelect }: ImportModeDialogProps) {
  return (
    <div className="space-y-3">
      {modes.map((mode) => {
        const isSelected = selected === mode.id
        return (
          <motion.button
            key={mode.id}
            onClick={() => onSelect(mode.id)}
            className={`w-full text-left rounded-xl border p-4 transition-all duration-200 group ${
              isSelected
                ? 'border-emerald-500/50 bg-emerald-500/[0.06]'
                : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
            }`}
            whileHover={{ scale: 1.005 }}
            whileTap={{ scale: 0.995 }}
          >
            <div className="flex items-start gap-3">
              {/* Radio circle */}
              <div className={`mt-0.5 flex items-center justify-center h-5 w-5 rounded-full border-2 shrink-0 transition-colors ${
                isSelected
                  ? 'border-emerald-500 bg-emerald-500'
                  : 'border-slate-600 group-hover:border-slate-500'
              }`}>
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  >
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  </motion.div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{mode.title}</span>
                    {mode.recommended && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200 bg-amber-500/15 border border-amber-500/20 rounded-md">
                        <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                        Direkomendasikan
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">{mode.description}</p>

                {/* Feature list */}
                <div className="flex flex-wrap gap-1.5">
                  {mode.features.map((feat) => (
                    <span
                      key={feat.label}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-slate-300 bg-white/[0.05] border border-white/[0.08] rounded-md"
                    >
                      <feat.icon className="h-2.5 w-2.5 opacity-60" />
                      {feat.label}
                    </span>
                  ))}
                </div>

                {/* Note */}
                <p className="text-[11px] text-slate-500 italic">{mode.note}</p>
              </div>
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}