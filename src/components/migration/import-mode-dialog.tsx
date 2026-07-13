'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Star, Package, Check, Zap, BookOpen, BarChart3, FileText, Boxes,
  UtensilsCrossed, Store, Sparkles, Scissors, Printer, Shirt, Pill,
  Smartphone, Wrench, Wheat, ArrowRight, Info, Lightbulb, ChevronDown, ChevronUp,
} from 'lucide-react'
import type { ImportMode } from './migration-banner'

interface ImportModeDialogProps {
  selected: ImportMode
  onSelect: (mode: ImportMode) => void
}

// ─── Industri & Mode Mapping ───────────────────────────────────
interface IndustryItem {
  name: string
  icon: React.ElementType
  mode: ImportMode
  reason: string
}

const industries: IndustryItem[] = [
  { name: 'F&B & Kuliner', icon: UtensilsCrossed, mode: 'product_only', reason: 'Menu tanpa tracking resep detail' },
  { name: 'Retail / Minimarket', icon: Store, mode: 'product_only', reason: 'Jual barang jadi langsung' },
  { name: 'Beauty / Kecantikan', icon: Sparkles, mode: 'product_only', reason: 'Jual produk jadi dari supplier' },
  { name: 'Jasa / Layanan', icon: Scissors, mode: 'product_only', reason: 'Tidak perlu inventory bahan' },
  { name: 'Farmasi / Kesehatan', icon: Pill, mode: 'product_only', reason: 'Jual obat & alat kesehatan jadi' },
  { name: 'Elektronik / Gadget', icon: Smartphone, mode: 'product_only', reason: 'Jual aksesoris & device jadi' },
  { name: 'Fashion (reseller)', icon: Shirt, mode: 'product_only', reason: 'Jual pakaian jadi dari supplier' },
  { name: 'Percetakan', icon: Printer, mode: 'product_inventory', reason: 'Perlu track kertas, tinta, bahan cetak' },
  { name: 'Fashion (konveksi)', icon: Shirt, mode: 'product_inventory', reason: 'Perlu track kain, benang, resleting' },
  { name: 'F&B dengan resep', icon: UtensilsCrossed, mode: 'product_inventory', reason: 'Perlu tracking bahan & perhitungan HPP' },
  { name: 'Bangunan / Material', icon: Wrench, mode: 'product_inventory', reason: 'Perlu track semen, pasir, besi, cat' },
  { name: 'Pertanian / Agrobisnis', icon: Wheat, mode: 'product_inventory', reason: 'Perlu track pupuk, benih, pestisida' },
]

// ─── Mode Definitions ─────────────────────────────────────────
const modes: {
  id: ImportMode
  title: string
  subtitle: string
  recommended?: boolean
  description: string
  features: { icon: React.ElementType; label: string }[]
  suitedFor: string[]
  note: string
}[] = [
  {
    id: 'product_only',
    title: 'Buat Produk Saja',
    subtitle: 'Paling Umum',
    recommended: true,
    description: 'Import produk langsung siap jual. Cukup isi nama & harga — cocok untuk sebagian besar bisnis.',
    features: [
      { icon: Package, label: 'Produk' },
      { icon: FileText, label: 'SKU & Barcode' },
      { icon: Zap, label: 'Harga Jual' },
      { icon: BookOpen, label: 'Kategori' },
      { icon: BarChart3, label: 'Stok Awal' },
    ],
    suitedFor: ['Retail', 'Minimarket', 'Jasa', 'Elektronik', 'Farmasi', 'Fashion reseller', 'F&B sederhana'],
    note: 'Inventory & Purchase bisa diaktifkan kapan saja dari menu Pembelian.',
  },
  {
    id: 'product_inventory',
    title: 'Buat Produk + Inventory',
    subtitle: null,
    recommended: false,
    description: 'Import produk sekaligus bahan baku & resep/komposisi. Untuk bisnis yang perlu tracking material.',
    features: [
      { icon: Package, label: 'Produk' },
      { icon: Boxes, label: 'Inventory Bahan' },
      { icon: FileText, label: 'Komposisi / BOM' },
      { icon: BarChart3, label: 'HPP Otomatis' },
      { icon: BookOpen, label: 'Yield / Batch' },
    ],
    suitedFor: ['F&B dengan resep', 'Percetakan', 'Konveksi', 'Bangunan', 'Pertanian', 'Manufactur'],
    note: 'Stok awal bahan baku otomatis menjadi saldo awal inventory.',
  },
]

export function ImportModeDialog({ selected, onSelect }: ImportModeDialogProps) {
  const [showIndustryGuide, setShowIndustryGuide] = useState(false)

  const productOnlyIndustries = industries.filter(i => i.mode === 'product_only')
  const productInventoryIndustries = industries.filter(i => i.mode === 'product_inventory')

  return (
    <div className="space-y-4">
      {/* ─── Industry Guide Toggle ─── */}
      <button
        type="button"
        onClick={() => setShowIndustryGuide(!showIndustryGuide)}
        className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-amber-500/15 border border-amber-500/20">
            <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-white">Mode mana yang cocok untuk bisnis saya?</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Lihat panduan sesuai jenis industri</p>
          </div>
        </div>
        {showIndustryGuide ? (
          <ChevronUp className="h-4 w-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
        )}
      </button>

      {/* ─── Industry Guide Content ─── */}
      <AnimatePresence>
        {showIndustryGuide && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-4">
              {/* Mode 1: Produk Saja */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-400">Produk Saja</span>
                  <span className="text-[10px] text-slate-500">— untuk bisnis jual langsung</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {productOnlyIndustries.map((ind) => {
                    const Icon = ind.icon
                    return (
                      <div
                        key={ind.name}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.04]"
                      >
                        <Icon className="h-3 w-3 text-slate-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-slate-300 truncate">{ind.name}</p>
                          <p className="text-[9px] text-slate-600 truncate">{ind.reason}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Mode 2: Produk + Inventory */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="h-2 w-2 rounded-full bg-violet-400" />
                  <span className="text-xs font-semibold text-violet-400">Produk + Inventory</span>
                  <span className="text-[10px] text-slate-500">— untuk bisnis yang olah bahan</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {productInventoryIndustries.map((ind) => {
                    const Icon = ind.icon
                    return (
                      <div
                        key={ind.name}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.04]"
                      >
                        <Icon className="h-3 w-3 text-slate-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-slate-300 truncate">{ind.name}</p>
                          <p className="text-[9px] text-slate-600 truncate">{ind.reason}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Mode Selection Cards ─── */}
      <div className="space-y-3">
        {modes.map((mode) => {
          const isSelected = selected === mode.id
          const isInventory = mode.id === 'product_inventory'

          return (
            <motion.button
              key={mode.id}
              onClick={() => onSelect(mode.id)}
              className={`w-full text-left rounded-xl border p-4 transition-all duration-200 group ${
                isSelected
                  ? isInventory
                    ? 'border-violet-500/50 bg-violet-500/[0.06]'
                    : 'border-emerald-500/50 bg-emerald-500/[0.06]'
                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
              }`}
              whileHover={{ scale: 1.005 }}
              whileTap={{ scale: 0.995 }}
            >
              <div className="flex items-start gap-3">
                {/* Radio circle */}
                <div className={`mt-0.5 flex items-center justify-center h-5 w-5 rounded-full border-2 shrink-0 transition-colors ${
                  isSelected
                    ? isInventory
                      ? 'border-violet-500 bg-violet-500'
                      : 'border-emerald-500 bg-emerald-500'
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
                    <span className="text-sm font-bold text-white">{mode.title}</span>
                    {mode.recommended && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200 bg-amber-500/15 border border-amber-500/20 rounded-md">
                        <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                        Paling Umum
                      </span>
                    )}
                    {mode.subtitle && (
                      <span className="text-[10px] text-slate-500">{mode.subtitle}</span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">{mode.description}</p>

                  {/* Suited for tags */}
                  <div className="flex flex-wrap gap-1">
                    {mode.suitedFor.map((item) => (
                      <span
                        key={item}
                        className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-medium rounded-md ${
                          isInventory
                            ? 'text-violet-300/70 bg-violet-500/[0.08] border border-violet-500/10'
                            : 'text-emerald-300/70 bg-emerald-500/[0.08] border border-emerald-500/10'
                        }`}
                      >
                        {item}
                      </span>
                    ))}
                  </div>

                  {/* Feature pills */}
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

      {/* ─── Tip ─── */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
        <Info className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Belum yakin? Pilih <span className="font-semibold text-slate-300">Buat Produk Saja</span> — inventory bisa diaktifkan kapan saja nanti melalui menu <span className="font-semibold text-slate-300">Pembelian</span>.
        </p>
      </div>
    </div>
  )
}