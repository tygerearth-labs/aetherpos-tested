'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Star, Package, Check, Zap, BookOpen, BarChart3, FileText, Boxes,
  UtensilsCrossed, Store, Sparkles, Scissors, Printer, Shirt, Pill,
  Smartphone, Wrench, Wheat, ArrowRight, Info, Lightbulb, ChevronDown, ChevronUp,
  Warehouse, Link2, Download, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ImportMode } from './migration-banner'

interface ImportModeDialogProps {
  selected: ImportMode
  onSelect: (mode: ImportMode) => void
  onDownloadTemplate?: (mode: ImportMode) => void
}

// ─── Industri & Mode Mapping ───────────────────────────────────
interface IndustryItem {
  name: string
  icon: React.ElementType
  mode: ImportMode
  reason: string
}

const industries: IndustryItem[] = [
  // product_only — jual langsung tanpa tracking stok
  { name: 'Jasa / Layanan', icon: Scissors, mode: 'product_only', reason: 'Tidak perlu stok' },
  { name: 'F&B sederhana', icon: UtensilsCrossed, mode: 'product_only', reason: 'Menu tanpa tracking stok' },

  // product_stock — ritel: produk = stok gudang
  { name: 'Retail / Minimarket', icon: Store, mode: 'product_stock', reason: 'Stok = produk yang dijual' },
  { name: 'Beauty / Kecantikan', icon: Sparkles, mode: 'product_stock', reason: 'Track stok produk jadi' },
  { name: 'Farmasi / Kesehatan', icon: Pill, mode: 'product_stock', reason: 'Track stok obat & alkes' },
  { name: 'Elektronik / Gadget', icon: Smartphone, mode: 'product_stock', reason: 'Track stok aksesoris & device' },
  { name: 'Fashion (reseller)', icon: Shirt, mode: 'product_stock', reason: 'Track stok pakaian jadi' },
  { name: 'F&B (tanpa resep)', icon: UtensilsCrossed, mode: 'product_stock', reason: 'Track stok bahan siap jual' },

  // product_inventory — manufaktur: bahan baku → produk via resep
  { name: 'F&B dengan resep', icon: UtensilsCrossed, mode: 'product_inventory', reason: 'Perlu tracking bahan & perhitungan HPP' },
  { name: 'Percetakan', icon: Printer, mode: 'product_inventory', reason: 'Track kertas, tinta, bahan cetak' },
  { name: 'Fashion (konveksi)', icon: Shirt, mode: 'product_inventory', reason: 'Track kain, benang, resleting' },
  { name: 'Bangunan / Material', icon: Wrench, mode: 'product_inventory', reason: 'Track semen, pasir, besi, cat' },
  { name: 'Pertanian / Agrobisnis', icon: Wheat, mode: 'product_inventory', reason: 'Track pupuk, benih, pestisida' },
]

// ─── Mode color helper ─────────────────────────────────────────
function modeColor(mode: ImportMode) {
  switch (mode) {
    case 'product_only': return { border: 'border-emerald-500/50', bg: 'bg-emerald-500/[0.06]', radio: 'border-emerald-500 bg-emerald-500', tag: 'text-emerald-300/70 bg-emerald-500/[0.08] border-emerald-500/10', dot: 'bg-emerald-400', label: 'text-emerald-400' }
    case 'product_stock': return { border: 'border-cyan-500/50', bg: 'bg-cyan-500/[0.06]', radio: 'border-cyan-500 bg-cyan-500', tag: 'text-cyan-300/70 bg-cyan-500/[0.08] border-cyan-500/10', dot: 'bg-cyan-400', label: 'text-cyan-400' }
    case 'product_inventory': return { border: 'border-violet-500/50', bg: 'bg-violet-500/[0.06]', radio: 'border-violet-500 bg-violet-500', tag: 'text-violet-300/70 bg-violet-500/[0.08] border-violet-500/10', dot: 'bg-violet-400', label: 'text-violet-400' }
  }
}

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
    title: 'Produk Saja',
    subtitle: 'Tanpa Stok',
    recommended: false,
    description: 'Import produk langsung siap jual. Cocok untuk bisnis jasa atau yang tidak perlu tracking stok.',
    features: [
      { icon: Package, label: 'Produk' },
      { icon: FileText, label: 'SKU & Barcode' },
      { icon: Zap, label: 'Harga Jual' },
      { icon: BookOpen, label: 'Kategori' },
    ],
    suitedFor: ['Jasa', 'Konsultasi', 'F&B sederhana'],
    note: 'Stok & inventory bisa diaktifkan kapan saja nanti.',
  },
  {
    id: 'product_stock',
    title: 'Produk + Stok Gudang',
    subtitle: 'Paling Umum',
    recommended: true,
    description: 'Import produk sekaligus stok gudang. Setiap produk otomatis terhubung ke inventory — cocok untuk bisnis ritel di mana stok = produk yang dijual.',
    features: [
      { icon: Package, label: 'Produk' },
      { icon: Warehouse, label: 'Stok Gudang' },
      { icon: Link2, label: 'Auto-link Produk↔Stok' },
      { icon: BarChart3, label: 'Stok Awal & HPP' },
      { icon: FileText, label: 'SKU & Barcode' },
    ],
    suitedFor: ['Retail', 'Minimarket', 'Elektronik', 'Farmasi', 'Fashion reseller', 'Beauty', 'F&B tanpa resep'],
    note: 'Stok produk akan otomatis berkurang saat terjual. HPP dihitung dari harga beli.',
  },
  {
    id: 'product_inventory',
    title: 'Produk + Komposisi',
    subtitle: 'Resep / BOM',
    recommended: false,
    description: 'Import produk, bahan baku terpisah, dan resep/komposisi. Untuk bisnis yang mengolah bahan menjadi produk jadi.',
    features: [
      { icon: Package, label: 'Produk' },
      { icon: Boxes, label: 'Inventory Bahan' },
      { icon: FileText, label: 'Komposisi / BOM' },
      { icon: BarChart3, label: 'HPP Otomatis' },
      { icon: BookOpen, label: 'Yield / Batch' },
    ],
    suitedFor: ['F&B dengan resep', 'Percetakan', 'Konveksi', 'Bangunan', 'Pertanian', 'Manufactur'],
    note: 'Stok bahan baku berkurang saat produk dijual berdasarkan resep.',
  },
]

export function ImportModeDialog({ selected, onSelect, onDownloadTemplate }: ImportModeDialogProps) {
  const [showIndustryGuide, setShowIndustryGuide] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (onDownloadTemplate) {
      onDownloadTemplate(selected)
      return
    }
    setIsDownloading(true)
    try {
      const res = await fetch(`/api/migration/template?mode=${selected}`)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `template-migrasi-${selected}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('Template berhasil diunduh')
    } catch {
      toast.error('Gagal mengunduh template')
    } finally {
      setIsDownloading(false)
    }
  }, [selected, onDownloadTemplate])

  const productOnlyIndustries = industries.filter(i => i.mode === 'product_only')
  const productStockIndustries = industries.filter(i => i.mode === 'product_stock')
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
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar">
              {/* Group 1: Produk Saja */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-400">Produk Saja</span>
                  <span className="text-[10px] text-slate-500">— tanpa tracking stok</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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

              {/* Group 2: Produk + Stok Gudang */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="h-2 w-2 rounded-full bg-cyan-400" />
                  <span className="text-xs font-semibold text-cyan-400">Produk + Stok Gudang</span>
                  <span className="text-[10px] text-slate-500">— ritel, stok = produk</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {productStockIndustries.map((ind) => {
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

              {/* Group 3: Produk + Komposisi */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="h-2 w-2 rounded-full bg-violet-400" />
                  <span className="text-xs font-semibold text-violet-400">Produk + Komposisi</span>
                  <span className="text-[10px] text-slate-500">— resep, BOM, olah bahan</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
          const colors = modeColor(mode.id)

          return (
            <motion.button
              key={mode.id}
              onClick={() => onSelect(mode.id)}
              className={`w-full text-left rounded-xl border p-4 transition-all duration-200 group ${
                isSelected
                  ? `${colors.border} ${colors.bg}`
                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
              }`}
              whileHover={{ scale: 1.005 }}
              whileTap={{ scale: 0.995 }}
            >
              <div className="flex items-start gap-3">
                {/* Radio circle */}
                <div className={`mt-0.5 flex items-center justify-center h-5 w-5 rounded-full border-2 shrink-0 transition-colors ${
                  isSelected
                    ? colors.radio
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
                        className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-medium rounded-md ${colors.tag}`}
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

      {/* ─── Download Template Button ─── */}
      <div className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 shrink-0">
          <Download className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white">Download Template</p>
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">
            {selected === 'product_only'
              ? '2 sheet — Produk Non-Varian & Varian (tanpa stok)'
              : selected === 'product_stock'
                ? '2 sheet — Produk + kolom STOK AWAL (stok gudang otomatis)'
                : '4 sheet — Produk, Bahan Baku & Komposisi/BOM'
            }
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/25 transition-colors disabled:opacity-50 shrink-0"
        >
          {isDownloading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          Download
        </button>
      </div>

      {/* ─── Tip ─── */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
        <Info className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Belum yakin? Pilih <span className="font-semibold text-cyan-300">Produk + Stok Gudang</span> — mode paling fleksibel untuk bisnis ritel. Bahan baku & resep bisa ditambahkan kapan saja.
        </p>
      </div>
    </div>
  )
}