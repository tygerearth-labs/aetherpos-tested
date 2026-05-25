'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter } from '@/components/ui/responsive-dialog'
import {
  Loader2,
  Layers,
  Trash2,
  Plus,
  Package,
  DollarSign,
  BarChart3,
  Info,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Copy,
} from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'

interface ProductVariant {
  id?: string
  name: string
  sku: string
  hpp: string
  price: string
  stock: string
}

interface Product {
  id: string
  name: string
  sku: string | null
  hpp: number
  price: number
  stock: number
  lowStockAlert: number
  image: string | null
  categoryId: string | null
  unit: string
  hasVariants?: boolean
  variants?: ProductVariant[]
}

interface Category {
  id: string
  name: string
  color: string
  _count?: { products: number }
}

interface ProductFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: Product | null
  onSaved: () => void
}

const UNITS = [
  { value: 'pcs', label: 'Pcs' },
  { value: 'ml', label: 'ml' },
  { value: 'lt', label: 'Liter' },
  { value: 'gr', label: 'Gram' },
  { value: 'kg', label: 'Kg' },
  { value: 'box', label: 'Box' },
  { value: 'pack', label: 'Pack' },
  { value: 'botol', label: 'Botol' },
  { value: 'gelas', label: 'Gelas' },
  { value: 'mangkuk', label: 'Mangkuk' },
  { value: 'porsi', label: 'Porsi' },
  { value: 'bungkus', label: 'Bungkus' },
  { value: 'sachet', label: 'Sachet' },
  { value: 'dus', label: 'Dus' },
  { value: 'rim', label: 'Rim' },
  { value: 'lembar', label: 'Lembar' },
  { value: 'meter', label: 'Meter' },
  { value: 'cm', label: 'cm' },
  { value: 'ons', label: 'Ons' },
]

export default function ProductFormDialog({ open, onOpenChange, product, onSaved }: ProductFormDialogProps) {
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'OWNER'
  const isEdit = !!product

  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [hasVariants, setHasVariants] = useState(false)
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [expandedVariant, setExpandedVariant] = useState<number>(0)

  // Mass fill state for variants
  const [massFill, setMassFill] = useState({ price: '', hpp: '', stock: '' })

  const [form, setForm] = useState({
    name: '',
    sku: '',
    hpp: '',
    price: '',
    stock: '',
    lowStockAlert: '10',
    image: '',
    categoryId: '',
    unit: 'pcs',
  })

  // Variant summary calculations
  const variantSummary = useMemo(() => {
    if (!hasVariants || variants.length === 0) return null
    const totalStock = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0)
    const prices = variants.map((v) => Number(v.price) || 0).filter((p) => p > 0)
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
    const filledCount = variants.filter((v) => v.name.trim()).length
    const totalHpp = variants.reduce((sum, v) => sum + (Number(v.hpp) || 0), 0)
    return { totalStock, minPrice, maxPrice, filledCount, totalHpp, priceRange: minPrice !== maxPrice }
  }, [hasVariants, variants])

  useEffect(() => {
    if (open) {
      fetch('/api/categories')
        .then((res) => res.json())
        .then((data) => setCategories(data.categories || []))
        .catch(() => {})
    }
  }, [open])

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name,
        sku: product.sku || '',
        hpp: String(product.hpp || 0),
        price: String(product.price || 0),
        stock: String(product.stock || 0),
        lowStockAlert: String(product.lowStockAlert || 10),
        image: product.image || '',
        categoryId: product.categoryId || '',
        unit: product.unit || 'pcs',
      })
      setHasVariants(!!product.hasVariants)
      if (product.variants && product.variants.length > 0) {
        setVariants(product.variants.map((v) => ({
          id: v.id,
          name: v.name || '',
          sku: v.sku || '',
          hpp: String(v.hpp || 0),
          price: String(v.price || 0),
          stock: String(v.stock || 0),
        })))
        setExpandedVariant(0)
      } else if (product.hasVariants) {
        setVariants([{ name: '', sku: '', hpp: '', price: '', stock: '' }])
        setExpandedVariant(0)
      } else {
        setVariants([])
      }
    } else {
      setForm({
        name: '',
        sku: '',
        hpp: '',
        price: '',
        stock: '',
        lowStockAlert: '10',
        image: '',
        categoryId: '',
        unit: 'pcs',
      })
      setHasVariants(false)
      setVariants([])
      setExpandedVariant(0)
      setMassFill({ price: '', hpp: '', stock: '' })
    }
  }, [product, open])

  useEffect(() => {
    if (open && product && product.hasVariants && (!product.variants || product.variants.length === 0)) {
      fetch(`/api/products/${product.id}/variants`)
        .then((res) => res.json())
        .then((data) => {
          if (data.variants && data.variants.length > 0) {
            setVariants(data.variants.map((v: any) => ({
              id: v.id,
              name: v.name || '',
              sku: v.sku || '',
              hpp: String(v.hpp || 0),
              price: String(v.price || 0),
              stock: String(v.stock || 0),
            })))
            setExpandedVariant(0)
          }
        })
        .catch(() => {})
    }
  }, [open, product])

  const updateVariant = (index: number, key: keyof ProductVariant, value: string) => {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [key]: value } : v)))
  }

  const addVariant = () => {
    const newIdx = variants.length
    setVariants((prev) => [...prev, { name: '', sku: '', hpp: '', price: '', stock: '' }])
    setExpandedVariant(newIdx)
  }

  const removeVariant = (index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index))
    if (expandedVariant >= variants.length - 1) {
      setExpandedVariant(Math.max(0, variants.length - 2))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Nama produk wajib diisi')
      return
    }
    if (hasVariants) {
      if (variants.length === 0) {
        toast.error('Minimal 1 varian diperlukan')
        return
      }
      for (let i = 0; i < variants.length; i++) {
        if (!variants[i].name.trim()) {
          toast.error(`Varian ${i + 1}: nama wajib diisi`)
          return
        }
        if (!variants[i].price || Number(variants[i].price) <= 0) {
          toast.error(`Varian ${i + 1}: harga jual wajib diisi`)
          return
        }
      }
    } else {
      if (!form.price || Number(form.price) <= 0) {
        toast.error('Harga jual wajib diisi')
        return
      }
    }

    setSaving(true)
    try {
      const body: Record<string, any> = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        hpp: isOwner ? Number(form.hpp) || 0 : 0,
        price: hasVariants ? 0 : Number(form.price),
        stock: hasVariants ? 0 : Number(form.stock) || 0,
        lowStockAlert: Number(form.lowStockAlert) || 10,
        image: form.image.trim() || null,
        categoryId: form.categoryId || null,
        unit: form.unit || 'pcs',
        hasVariants,
        variants: hasVariants
          ? variants.map((v) => ({
              name: v.name.trim(),
              sku: v.sku.trim() || null,
              hpp: Number(v.hpp) || 0,
              price: Number(v.price),
              stock: Number(v.stock) || 0,
            }))
          : [],
      }

      const url = isEdit ? `/api/products/${product.id}` : '/api/products'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success(isEdit ? 'Produk berhasil diperbarui' : 'Produk berhasil ditambahkan')
        onOpenChange(false)
        onSaved()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menyimpan produk')
      }
    } catch {
      toast.error('Gagal menyimpan produk')
    } finally {
      setSaving(false)
    }
  }

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const toggleVariantExpand = (idx: number) => {
    setExpandedVariant((prev) => (prev === idx ? -1 : idx))
  }

  const applyMassFill = () => {
    if (variants.length === 0) return
    const updated = variants.map((v) => ({
      ...v,
      ...(massFill.price ? { price: massFill.price } : {}),
      ...(massFill.hpp ? { hpp: massFill.hpp } : {}),
      ...(massFill.stock ? { stock: massFill.stock } : {}),
    }))
    setVariants(updated)
    toast.success(`Berhasil menerapkan ke ${updated.length} varian`)
  }

  const clearMassFill = () => {
    setMassFill({ price: '', hpp: '', stock: '' })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="bg-zinc-950 border-zinc-800/80 p-0 max-h-[92vh] overflow-hidden flex flex-col" desktopClassName="max-w-xl">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-zinc-800/60">
          <ResponsiveDialogHeader className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Package className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <ResponsiveDialogTitle className="text-sm font-bold text-zinc-100">
                  {isEdit ? 'Edit Produk' : 'Tambah Produk Baru'}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="text-[11px] text-zinc-500 mt-0.5">
                  {isEdit ? 'Ubah detail produk yang sudah ada' : 'Isi detail produk untuk ditambahkan ke inventori'}
                </ResponsiveDialogDescription>
              </div>
            </div>
          </ResponsiveDialogHeader>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 custom-scrollbar">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* ========== SECTION: Info Dasar ========== */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-emerald-400" />
                <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Info Dasar</span>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300 font-medium">
                  Nama Produk <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Contoh: Kopi Susu Gula Aren"
                  required
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 h-10 text-sm rounded-lg focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">Kategori</Label>
                  <select
                    value={form.categoryId}
                    onChange={(e) => updateField('categoryId', e.target.value)}
                    className="w-full h-10 text-sm bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-lg px-3 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500/50 appearance-none cursor-pointer"
                  >
                    <option value="">Tanpa Kategori</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">Satuan</Label>
                  <select
                    value={form.unit}
                    onChange={(e) => updateField('unit', e.target.value)}
                    className="w-full h-10 text-sm bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-lg px-3 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500/50 appearance-none cursor-pointer"
                  >
                    {UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400">SKU / Barcode</Label>
                <Input
                  value={form.sku}
                  onChange={(e) => updateField('sku', e.target.value)}
                  placeholder="Opsional — Contoh: SKU-001"
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 h-10 text-sm rounded-lg focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400">Gambar Produk (URL)</Label>
                <Input
                  value={form.image}
                  onChange={(e) => updateField('image', e.target.value)}
                  placeholder="Opsional — https://..."
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 h-10 text-sm rounded-lg focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                />
              </div>
            </div>

            <Separator className="bg-zinc-800/60" />

            {/* ========== SECTION: Harga & Stok (non-variant mode) ========== */}
            {!hasVariants && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-1 rounded-full bg-emerald-400" />
                  <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Harga & Stok</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-300 font-medium">
                      Harga Jual <span className="text-red-400">*</span>
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 font-medium">Rp</span>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={form.price}
                        onChange={(e) => updateField('price', e.target.value)}
                        placeholder="0"
                        required
                        className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 h-10 text-sm rounded-lg pl-8 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                      />
                    </div>
                  </div>

                  {isOwner && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-zinc-400">
                        HPP <span className="text-zinc-600">(Modal)</span>
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 font-medium">Rp</span>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={form.hpp}
                          onChange={(e) => updateField('hpp', e.target.value)}
                          placeholder="0"
                          className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 h-10 text-sm rounded-lg pl-8 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Profit preview */}
                {isOwner && form.price && Number(form.price) > 0 && (
                  <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">Estimasi Keuntungan</span>
                      <span className="text-sm font-semibold text-emerald-400">
                        {formatCurrency(Number(form.price) - (Number(form.hpp) || 0))}
                      </span>
                    </div>
                    {Number(form.price) > 0 && Number(form.hpp) > 0 && (
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-zinc-600">Margin</span>
                        <span className="text-[11px] text-zinc-400">
                          {(((Number(form.price) - Number(form.hpp)) / Number(form.price)) * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-300 font-medium">
                      Stok Awal <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.stock}
                      onChange={(e) => updateField('stock', e.target.value)}
                      placeholder="0"
                      required
                      className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 h-10 text-sm rounded-lg focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-400">
                      Peringatan Stok Rendah
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.lowStockAlert}
                      onChange={(e) => updateField('lowStockAlert', e.target.value)}
                      placeholder="10"
                      className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 h-10 text-sm rounded-lg focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ========== SECTION: Variant Toggle ========== */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-emerald-400" />
                <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Varian Produk</span>
              </div>

              <div
                className={`rounded-xl border p-4 transition-all duration-200 cursor-pointer ${
                  hasVariants
                    ? 'bg-emerald-500/5 border-emerald-500/30 ring-1 ring-emerald-500/10'
                    : 'bg-zinc-900/40 border-zinc-800/60 hover:border-zinc-700'
                }`}
                onClick={() => {
                  if (!hasVariants) {
                    setHasVariants(true)
                    if (variants.length === 0) {
                      setVariants([{ name: '', sku: '', hpp: '', price: '', stock: '' }])
                      setExpandedVariant(0)
                    }
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
                      hasVariants ? 'bg-emerald-500/15' : 'bg-zinc-800'
                    }`}>
                      <Layers className={`h-4 w-4 transition-colors ${hasVariants ? 'text-emerald-400' : 'text-zinc-500'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-200">Aktifkan Varian</p>
                      <p className="text-[11px] text-zinc-500">
                        {hasVariants
                          ? 'Harga, HPP & stok diatur per varian'
                          : 'Produk memiliki ukuran, rasa, atau tipe yang berbeda?'
                        }
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={hasVariants}
                    onCheckedChange={(checked) => {
                      setHasVariants(checked)
                      if (checked && variants.length === 0) {
                        setVariants([{ name: '', sku: '', hpp: '', price: '', stock: '' }])
                        setExpandedVariant(0)
                      } else if (!checked) {
                        setVariants([])
                        setExpandedVariant(-1)
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            </div>

            {/* ========== SECTION: Variant Management ========== */}
            {hasVariants && (
              <div className="space-y-3">
                {/* Variant summary bar */}
                {variantSummary && variants.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg p-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        <Layers className="h-3 w-3 text-zinc-500" />
                        <span className="text-[10px] text-zinc-500">Varian</span>
                      </div>
                      <p className="text-sm font-bold text-zinc-200">{variantSummary.filledCount}</p>
                    </div>
                    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg p-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        <Package className="h-3 w-3 text-zinc-500" />
                        <span className="text-[10px] text-zinc-500">Total Stok</span>
                      </div>
                      <p className="text-sm font-bold text-zinc-200">{formatNumber(variantSummary.totalStock)}</p>
                    </div>
                    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg p-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        <DollarSign className="h-3 w-3 text-zinc-500" />
                        <span className="text-[10px] text-zinc-500">Harga</span>
                      </div>
                      <p className="text-sm font-bold text-zinc-200">
                        {variantSummary.priceRange
                          ? `${formatCurrency(variantSummary.minPrice)}~`
                          : formatCurrency(variantSummary.minPrice)
                        }
                      </p>
                    </div>
                  </div>
                )}

                {/* Mass fill section */}
                {variants.length >= 1 && (
                  <div className="rounded-xl border border-dashed border-zinc-700/60 bg-zinc-900/30 p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Copy className="h-3.5 w-3.5 text-zinc-500" />
                        <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Isi Massal Varian</span>
                      </div>
                      {(massFill.price || massFill.hpp || massFill.stock) && (
                        <button
                          type="button"
                          onClick={clearMassFill}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-600 leading-relaxed">
                      Isi untuk menerapkan harga, HPP, dan stok yang sama ke <strong>semua varian sekaligus</strong>. Kosongkan field yang tidak ingin diubah.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-500">Harga Jual</Label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-zinc-600">Rp</span>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={massFill.price}
                            onChange={(e) => setMassFill((p) => ({ ...p, price: e.target.value }))}
                            placeholder="Kosongkan"
                            className="bg-zinc-800/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-700 h-8 text-[11px] rounded-md pl-6 focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
                          />
                        </div>
                      </div>
                      {isOwner && (
                        <div className="space-y-1">
                          <Label className="text-[10px] text-zinc-500">HPP (Modal)</Label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-zinc-600">Rp</span>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={massFill.hpp}
                              onChange={(e) => setMassFill((p) => ({ ...p, hpp: e.target.value }))}
                              placeholder="Kosongkan"
                              className="bg-zinc-800/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-700 h-8 text-[11px] rounded-md pl-6 focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
                            />
                          </div>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-500">Stok</Label>
                        <Input
                          type="number"
                          min="0"
                          value={massFill.stock}
                          onChange={(e) => setMassFill((p) => ({ ...p, stock: e.target.value }))}
                          placeholder="Kosongkan"
                          className="bg-zinc-800/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-700 h-8 text-[11px] rounded-md focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      onClick={applyMassFill}
                      disabled={!massFill.price && !massFill.hpp && !massFill.stock}
                      className="w-full h-8 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 text-violet-400 hover:text-violet-300 text-[11px] font-medium rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Copy className="mr-1.5 h-3 w-3" />
                      Terapkan ke {variants.length} Varian
                    </Button>
                  </div>
                )}

                {/* Low stock alert for variant mode */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">
                    Peringatan Stok Rendah
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.lowStockAlert}
                    onChange={(e) => updateField('lowStockAlert', e.target.value)}
                    placeholder="10"
                    className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 h-10 text-sm rounded-lg focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                  />
                </div>

                {/* Variant list */}
                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1 custom-scrollbar">
                  {variants.map((variant, index) => {
                    const isExpanded = expandedVariant === index
                    const hasName = variant.name.trim().length > 0
                    const vPrice = Number(variant.price) || 0
                    const vStock = Number(variant.stock) || 0
                    const vHpp = Number(variant.hpp) || 0

                    return (
                      <div
                        key={index}
                        className={`rounded-xl border transition-all duration-150 overflow-hidden ${
                          isExpanded
                            ? 'bg-zinc-900 border-zinc-700/80 ring-1 ring-zinc-700/40'
                            : 'bg-zinc-900/40 border-zinc-800/60 hover:border-zinc-700/60'
                        }`}
                      >
                        {/* Collapsed header */}
                        <div
                          className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer"
                          onClick={() => toggleVariantExpand(index)}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                              hasName ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-600'
                            }`}>
                              {hasName ? variant.name.charAt(0).toUpperCase() : index + 1}
                            </div>
                            <div className="min-w-0">
                              <p className={`text-xs font-medium truncate ${hasName ? 'text-zinc-200' : 'text-zinc-600'}`}>
                                {hasName ? variant.name : `Varian ${index + 1}`}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {vPrice > 0 && (
                                  <span className="text-[10px] text-zinc-500">{formatCurrency(vPrice)}</span>
                                )}
                                <span className="text-[10px] text-zinc-600">Stok: {formatNumber(vStock)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {vPrice > 0 && vHpp > 0 && (
                              <Badge className="bg-emerald-500/10 border-emerald-500/20 text-emerald-400 text-[9px] px-1.5 py-0 mr-1">
                                +{formatCurrency(vPrice - vHpp)}
                              </Badge>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                removeVariant(index)
                              }}
                              disabled={variants.length <= 1}
                              className="h-6 w-6 p-0 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5 text-zinc-500" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                            )}
                          </div>
                        </div>

                        {/* Expanded form */}
                        {isExpanded && (
                          <div className="px-3.5 pb-3.5 pt-1 border-t border-zinc-800/60 space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-zinc-400 font-medium">
                                Nama Varian <span className="text-red-400">*</span>
                              </Label>
                              <Input
                                value={variant.name}
                                onChange={(e) => updateVariant(index, 'name', e.target.value)}
                                placeholder="Contoh: Small, Medium, Large"
                                className="bg-zinc-800/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 h-9 text-xs rounded-lg focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-zinc-500">SKU Varian</Label>
                              <Input
                                value={variant.sku}
                                onChange={(e) => updateVariant(index, 'sku', e.target.value)}
                                placeholder="Opsional"
                                className="bg-zinc-800/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 h-9 text-xs rounded-lg focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                              />
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div className="space-y-1.5">
                                <Label className="text-[10px] text-zinc-500">HPP (Modal)</Label>
                                <div className="relative">
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600">Rp</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={variant.hpp}
                                    onChange={(e) => updateVariant(index, 'hpp', e.target.value)}
                                    placeholder="0"
                                    className="bg-zinc-800/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 h-9 text-xs rounded-lg pl-7 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                                  />
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-[10px] text-zinc-400 font-medium">
                                  Harga Jual <span className="text-red-400">*</span>
                                </Label>
                                <div className="relative">
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600">Rp</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={variant.price}
                                    onChange={(e) => updateVariant(index, 'price', e.target.value)}
                                    placeholder="0"
                                    className="bg-zinc-800/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 h-9 text-xs rounded-lg pl-7 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                                  />
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-[10px] text-zinc-500">Stok</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  value={variant.stock}
                                  onChange={(e) => updateVariant(index, 'stock', e.target.value)}
                                  placeholder="0"
                                  className="bg-zinc-800/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 h-9 text-xs rounded-lg focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50"
                                />
                              </div>
                            </div>

                            {/* Variant profit preview */}
                            {isOwner && vPrice > 0 && vHpp > 0 && (
                              <div className="bg-zinc-800/40 rounded-lg p-2 flex items-center justify-between">
                                <span className="text-[10px] text-zinc-500">Keuntungan</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-medium text-emerald-400">{formatCurrency(vPrice - vHpp)}</span>
                                  <span className="text-[10px] text-zinc-600">
                                    ({(((vPrice - vHpp) / vPrice) * 100).toFixed(1)}%)
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Add variant button */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={addVariant}
                  className="w-full h-10 border-dashed border-zinc-700/60 text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/40 hover:bg-emerald-500/5 text-xs rounded-lg"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Tambah Varian
                </Button>
              </div>
            )}

            {/* Info note */}
            {hasVariants && (
              <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/15 rounded-lg p-3">
                <Info className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-[11px] text-amber-300/80 leading-relaxed">
                  Saat varian aktif, <span className="font-medium text-amber-300">harga, HPP, dan stok diatur per varian</span>. Kolom harga & stok utama akan disembunyikan. Total stok produk adalah penjumlahan stok semua varian.
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-800/60 bg-zinc-950/80">
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 h-9 text-xs rounded-lg"
            >
              Batal
            </Button>
            <Button
              type="submit"
              onClick={handleSubmit}
              disabled={saving}
              className="bg-emerald-500 hover:bg-emerald-600 text-white h-9 text-xs font-medium rounded-lg shadow-lg shadow-emerald-500/20 min-w-[100px]"
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {isEdit ? 'Simpan' : 'Tambah Produk'}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
