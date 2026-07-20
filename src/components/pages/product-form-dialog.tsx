'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
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
  X,
  Beaker,
} from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ProductVariant {
  id?: string
  name: string
  sku: string
  hpp: string
  price: string
  stock: string
  compositions?: CompositionItem[]
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

interface CompositionItem {
  inventoryItemId: string
  inventoryItemName: string
  qty: string
  baseUnit: string
  avgCost: number
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

  // Composition / Recipe state
  const [hasComposition, setHasComposition] = useState(false)
  const [compositions, setCompositions] = useState<CompositionItem[]>([])
  const [inventoryItems, setInventoryItems] = useState<Array<{ id: string; name: string; baseUnit: string; avgCost: number; stock: number }>>([])
  const initialHasComposition = useRef(false)

  // Per-variant composition state (maps variant INDEX to its composition items)
  const [variantCompositions, setVariantCompositions] = useState<Record<number, CompositionItem[]>>({})

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

  // Auto-calculated HPP from composition (product-level, non-variant)
  const autoHpp = useMemo(() => {
    if (!hasComposition || compositions.length === 0) return 0
    return compositions.reduce((sum, c) => sum + (Number(c.qty) || 0) * (c.avgCost || 0), 0)
  }, [hasComposition, compositions])

  // Max possible stock from composition = min(inventoryStock / compQty) across all items (product-level)
  const maxStockFromComposition = useMemo(() => {
    if (!hasComposition || compositions.length === 0) return Infinity
    let maxUnits = Infinity
    for (const c of compositions) {
      const compQty = Number(c.qty) || 0
      if (compQty <= 0) continue
      // Find current inventory stock
      const invItem = inventoryItems.find((ii) => ii.id === c.inventoryItemId)
      const availableStock = invItem?.stock ?? 0
      const possible = Math.floor(availableStock / compQty)
      if (possible < maxUnits) maxUnits = possible
    }
    return maxUnits
  }, [hasComposition, compositions, inventoryItems])

  // Per-variant auto HPP calculation
  const getVariantAutoHpp = (variantIndex: number): number => {
    const comps = variantCompositions[variantIndex] || []
    return comps.reduce((sum, c) => sum + (Number(c.qty) || 0) * (c.avgCost || 0), 0)
  }

  // Per-variant max stock calculation
  const getVariantMaxStock = (variantIndex: number): number => {
    const comps = variantCompositions[variantIndex] || []
    if (comps.length === 0) return Infinity
    let maxUnits = Infinity
    for (const c of comps) {
      const compQty = Number(c.qty) || 0
      if (compQty <= 0) continue
      const invItem = inventoryItems.find((ii) => ii.id === c.inventoryItemId)
      const availableStock = invItem?.stock ?? 0
      const possible = Math.floor(availableStock / compQty)
      if (possible < maxUnits) maxUnits = possible
    }
    return maxUnits
  }

  useEffect(() => {
    if (open) {
      fetch('/api/categories')
        .then((res) => res.json())
        .then((data) => setCategories(data.categories || []))
        .catch(() => {})
    }
  }, [open])

  // Load inventory items when composition is enabled
  useEffect(() => {
    if (open && hasComposition) {
      fetch('/api/inventory/items')
        .then((res) => res.json())
        .then((data) => setInventoryItems(data.items || []))
        .catch(() => {})
    }
  }, [open, hasComposition])

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

      // Load composition data
      // FIX-COMP-A: Variant products return { hasComposition, hasVariants, variantCompositions }
      // Non-variant products return { hasComposition, hasVariants, items, autoHpp }
      // The previous code only checked `data.items` — for variant products that field
      // is undefined, so it fell into the else branch and silently set hasComposition=false,
      // then attempted variant recovery below. The recovery worked only if variant names
      // matched EXACTLY (case-sensitive). Combined effect: composition toggle appeared
      // off for variant products after edit-load.
      fetch(`/api/products/${product.id}/composition`)
        .then((res) => res.json())
        .then((data) => {
          // Trust the server-side hasComposition flag — it reflects DB state.
          const serverHasComposition = !!data.hasComposition
          initialHasComposition.current = serverHasComposition
          setHasComposition(serverHasComposition)

          if (serverHasComposition && !data.hasVariants && Array.isArray(data.items)) {
            // Non-variant composition path
            setCompositions(data.items.map((item: any) => ({
              inventoryItemId: item.inventoryItemId,
              inventoryItemName: item.inventoryItemName,
              qty: String(item.qty),
              baseUnit: item.baseUnit,
              avgCost: item.avgCost || 0,
            })))
          } else {
            setCompositions([])
          }

          // Load per-variant compositions for variant + composition mode
          if (serverHasComposition && data.hasVariants && Array.isArray(data.variantCompositions)) {
            const vcMap: Record<number, CompositionItem[]> = {}
            const currentVariants = product.variants && product.variants.length > 0
              ? product.variants
              : []
            for (const vc of data.variantCompositions) {
              // FIX-COMP-B: case-insensitive, trimmed name match (was exact match).
              // Variant names with trailing whitespace or different casing (e.g.
              // "Small " vs "small") previously caused composition to be unloaded.
              const vIdx = currentVariants.findIndex(v =>
                v.name.trim().toLowerCase() === String(vc.variantName).trim().toLowerCase()
              )
              if (vIdx >= 0 && Array.isArray(vc.compositions)) {
                vcMap[vIdx] = vc.compositions.map((item: any) => ({
                  inventoryItemId: item.inventoryItemId,
                  inventoryItemName: item.inventoryItemName,
                  qty: String(item.qty),
                  baseUnit: item.baseUnit,
                  avgCost: item.avgCost || 0,
                }))
              }
            }
            setVariantCompositions(vcMap)
          } else {
            setVariantCompositions({})
          }
        })
        .catch(() => {
          setHasComposition(false)
          setCompositions([])
          setVariantCompositions({})
          initialHasComposition.current = false
        })
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
      setHasComposition(false)
      setCompositions([])
      setVariantCompositions({})
      initialHasComposition.current = false
    }
  }, [product, open])

  useEffect(() => {
    if (open && product && product.hasVariants && (!product.variants || product.variants.length === 0)) {
      fetch(`/api/products/${product.id}/variants`)
        .then((res) => res.json())
        .then((data) => {
          // FIX-COMP-C: GET /api/products/[id]/variants returns a BARE ARRAY, not {variants: [...]}.
          // The old code `data.variants && data.variants.length > 0` was always false → variants
          // never loaded → downstream composition name-matching failed → composition "unlink".
          const variantList: any[] = Array.isArray(data) ? data : (Array.isArray(data?.variants) ? data.variants : [])
          if (variantList.length > 0) {
            setVariants(variantList.map((v: any) => ({
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
    // Shift variantCompositions keys when a variant is removed
    setVariantCompositions((prev) => {
      const next: Record<number, CompositionItem[]> = {}
      const keys = Object.keys(prev)
        .map(Number)
        .sort((a, b) => a - b)
      for (const key of keys) {
        if (key === index) continue // skip removed
        const newKey = key > index ? key - 1 : key
        next[newKey] = prev[key]
      }
      return next
    })
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

    // Validate composition stock doesn't exceed available inventory (non-variant)
    if (hasComposition && !hasVariants && maxStockFromComposition !== Infinity) {
      const requestedStock = Number(form.stock) || 0
      if (requestedStock > maxStockFromComposition) {
        toast.error(`Stok melebihi kapasitas item. Maksimal ${maxStockFromComposition} ${form.unit || 'pcs'} yang bisa dibuat dari stok inventory saat ini.`)
        return
      }
    }

    // Validate product-level composition (non-variant mode)
    if (hasComposition && !hasVariants && compositions.length === 0) {
      toast.error('Tambahkan minimal 1 item untuk komposisi')
      return
    }
    if (hasComposition && !hasVariants) {
      for (let i = 0; i < compositions.length; i++) {
        if (!compositions[i].inventoryItemId || !Number(compositions[i].qty) || Number(compositions[i].qty) <= 0) {
          toast.error(`Komposisi ${i + 1}: isi jumlah item`)
          return
        }
      }
    }

    // Validate per-variant composition (variant + composition mode)
    if (hasComposition && hasVariants) {
      for (let i = 0; i < variants.length; i++) {
        const comps = variantCompositions[i] || []
        if (comps.length === 0) {
          toast.error(`Varian "${variants[i].name || i + 1}": tambahkan minimal 1 item untuk komposisi`)
          return
        }
        for (let j = 0; j < comps.length; j++) {
          if (!comps[j].inventoryItemId || !Number(comps[j].qty) || Number(comps[j].qty) <= 0) {
            toast.error(`Varian "${variants[i].name || i + 1}", item ${j + 1}: isi jumlah item`)
            return
          }
        }
        // Validate stock doesn't exceed composition capacity
        const maxStock = getVariantMaxStock(i)
        if (maxStock !== Infinity) {
          const requestedStock = Number(variants[i].stock) || 0
          if (requestedStock > maxStock) {
            toast.error(`Stok varian "${variants[i].name || i + 1}" melebihi kapasitas item. Maksimal ${maxStock} unit.`)
            return
          }
        }
      }
    }

    setSaving(true)
    try {
      const body: Record<string, any> = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        hpp: hasComposition && !hasVariants ? autoHpp : (isOwner ? Number(form.hpp) || 0 : 0),
        price: hasVariants ? 0 : Number(form.price),
        stock: hasVariants ? 0 : Number(form.stock) || 0,
        lowStockAlert: Number(form.lowStockAlert) || 10,
        image: form.image.trim() || null,
        categoryId: form.categoryId || null,
        unit: form.unit || 'pcs',
        hasVariants,
        variants: hasVariants
          ? variants.map((v, idx) => ({
              name: v.name.trim(),
              sku: v.sku.trim() || null,
              hpp: hasComposition ? getVariantAutoHpp(idx) : (Number(v.hpp) || 0),
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
        const savedProduct = await res.json()
        const productId = isEdit ? product!.id : savedProduct.id

        // Sync composition state
        // FIX-COMP-D: shouldSync must fire whenever composition state changed OR
        // was previously enabled (so toggling OFF also syncs to clear DB records).
        const shouldSync = hasComposition || (isEdit && initialHasComposition.current)

        // FIX-COMP-E: helper to call composition PUT and check response.
        // Previously the response was discarded, so any failure (validation,
        // inventory item not found, etc.) was silently swallowed → user saw
        // success toast but composition was actually not saved ("unlink").
        const syncComposition = async (payload: Record<string, unknown>): Promise<void> => {
          const compRes = await fetch(`/api/products/${productId}/composition`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!compRes.ok) {
            const err = await compRes.json().catch(() => ({}))
            throw new Error(err?.error || `Gagal menyimpan komposisi (status ${compRes.status})`)
          }
        }

        try {
          if (shouldSync && hasComposition && hasVariants) {
            // Per-variant composition mode
            // Fetch saved variants to get their IDs.
            // FIX-COMP-F: GET /api/products/[id]/variants returns BARE ARRAY, not {variants: [...]}.
            // The old code `savedVariantsData.variants || []` was always [] → vcMap was
            // always empty → PUT composition silently set hasComposition=false and DELETED
            // all existing composition records (the "unlink" symptom).
            const savedVariantsRes = await fetch(`/api/products/${productId}/variants`)
            const savedVariantsData = await savedVariantsRes.json()
            const savedVariants: any[] = Array.isArray(savedVariantsData)
              ? savedVariantsData
              : (Array.isArray(savedVariantsData?.variants) ? savedVariantsData.variants : [])

            const vcMap: Record<string, Array<{ inventoryItemId: string; qty: number; baseUnit: string }>> = {}

            // Match by name (case-insensitive, trimmed) since we don't have IDs in the form state
            for (let i = 0; i < variants.length; i++) {
              const formVariant = variants[i]
              const formNameKey = formVariant.name.trim().toLowerCase()
              const savedV = savedVariants.find((sv: any) =>
                String(sv.name || '').trim().toLowerCase() === formNameKey
              )
              if (!savedV) continue
              const comps = variantCompositions[i] || []
              if (comps.length > 0) {
                vcMap[savedV.id] = comps
                  .filter((c) => c.inventoryItemId && Number(c.qty) > 0)
                  .map((c) => ({
                    inventoryItemId: c.inventoryItemId,
                    qty: Number(c.qty),
                    baseUnit: c.baseUnit,
                  }))
              }
            }

            // FIX-COMP-G: preserve user's toggle state.
            // Old code: hasComposition: Object.keys(vcMap).length > 0 — if user toggled
            // composition ON but no variants had items yet, hasComposition was silently
            // downgraded to false. Now: pass through user's toggle state.
            await syncComposition({
              hasComposition: true,
              variantCompositions: vcMap,
            })
          } else if (shouldSync && hasComposition && !hasVariants) {
            // Product-level composition mode (non-variant)
            const compData = compositions
              .filter((c) => c.inventoryItemId && Number(c.qty) > 0)
              .map((c) => ({
                inventoryItemId: c.inventoryItemId,
                qty: Number(c.qty),
                baseUnit: c.baseUnit,
              }))

            // FIX-COMP-G: preserve user's toggle state (see above).
            await syncComposition({
              hasComposition: true,
              compositions: compData,
            })
          } else if (shouldSync && !hasComposition) {
            // Composition was toggled off, clear it
            await syncComposition({
              hasComposition: false,
              compositions: [],
            })
          }
        } catch (compError) {
          // Composition sync failed — surface to user. The product itself was saved,
          // so we don't roll back; we just tell the user to retry composition.
          toast.error(compError instanceof Error ? compError.message : 'Gagal menyimpan komposisi')
          onSaved() // still refresh product list so user can see the saved product
          onOpenChange(false)
          return
        }

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
      // Skip HPP mass fill when composition is active (HPP is auto-calculated)
      ...(!hasComposition && massFill.hpp ? { hpp: massFill.hpp } : {}),
      ...(massFill.stock ? { stock: massFill.stock } : {}),
    }))
    setVariants(updated)
    toast.success(`Berhasil menerapkan ke ${updated.length} varian`)
  }

  const clearMassFill = () => {
    setMassFill({ price: '', hpp: '', stock: '' })
  }

  // Composition helpers (product-level)
  const addComposition = (inventoryItemId: string) => {
    const item = inventoryItems.find((i) => i.id === inventoryItemId)
    if (!item) return
    if (compositions.some((c) => c.inventoryItemId === inventoryItemId)) {
      toast.error('Item ini sudah ditambahkan')
      return
    }
    setCompositions((prev) => [...prev, {
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      qty: '',
      baseUnit: item.baseUnit,
      avgCost: item.avgCost,
    }])
  }

  const removeComposition = (index: number) => {
    setCompositions((prev) => prev.filter((_, i) => i !== index))
  }

  const updateCompositionQty = (index: number, value: string) => {
    setCompositions((prev) => prev.map((c, i) => (i === index ? { ...c, qty: value } : c)))
  }

  // Per-variant composition helpers
  const addVariantComposition = (variantIndex: number, inventoryItemId: string) => {
    const item = inventoryItems.find((i) => i.id === inventoryItemId)
    if (!item) return
    const existing = variantCompositions[variantIndex] || []
    if (existing.some((c) => c.inventoryItemId === inventoryItemId)) {
      toast.error('Item ini sudah ditambahkan')
      return
    }
    setVariantCompositions(prev => ({
      ...prev,
      [variantIndex]: [...existing, {
        inventoryItemId: item.id,
        inventoryItemName: item.name,
        qty: '',
        baseUnit: item.baseUnit,
        avgCost: item.avgCost,
      }]
    }))
  }

  const removeVariantComposition = (variantIndex: number, compIndex: number) => {
    setVariantCompositions(prev => ({
      ...prev,
      [variantIndex]: (prev[variantIndex] || []).filter((_, i) => i !== compIndex)
    }))
  }

  const updateVariantCompositionQty = (variantIndex: number, compIndex: number, value: string) => {
    setVariantCompositions(prev => ({
      ...prev,
      [variantIndex]: (prev[variantIndex] || []).map((c, i) => i === compIndex ? { ...c, qty: value } : c)
    }))
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="bg-deep-space border-white/[0.06] p-0 max-h-[92vh] overflow-hidden flex flex-col" desktopClassName="max-w-xl">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <ResponsiveDialogHeader className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg theme-bg-very-light flex items-center justify-center">
                <Package className="h-4 w-4 theme-text" />
              </div>
              <div>
                <ResponsiveDialogTitle className="text-sm font-bold text-white">
                  {isEdit ? 'Edit Produk' : 'Tambah Produk Baru'}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="text-[11px] text-slate-500 mt-0.5">
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
                <div className="h-1 w-1 rounded-full theme-bg-light" />
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Info Dasar</span>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-300 font-medium">
                  Nama Produk <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Contoh: Kopi Susu Gula Aren"
                  required
                  className="bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 h-10 text-sm rounded-lg focus-visible:theme-ring focus-visible:theme-border"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-400">Kategori</Label>
                  <select
                    value={form.categoryId}
                    onChange={(e) => updateField('categoryId', e.target.value)}
                    className="w-full h-10 text-sm bg-nebula border border-white/[0.06] text-white rounded-lg px-3 focus:outline-none focus:ring-1 focus:theme-ring focus:theme-border appearance-none cursor-pointer"
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
                  <Label className="text-xs text-slate-400">Satuan</Label>
                  <select
                    value={form.unit}
                    onChange={(e) => updateField('unit', e.target.value)}
                    className="w-full h-10 text-sm bg-nebula border border-white/[0.06] text-white rounded-lg px-3 focus:outline-none focus:ring-1 focus:theme-ring focus:theme-border appearance-none cursor-pointer"
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
                <Label className="text-xs text-slate-400">SKU</Label>
                <Input
                  value={form.sku}
                  onChange={(e) => updateField('sku', e.target.value)}
                  placeholder="Opsional — Auto-generate jika kosong"
                  maxLength={22}
                  className="bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 h-10 text-sm rounded-lg focus-visible:theme-ring focus-visible:theme-border"
                />
                <p className="text-[10px] text-slate-600">Kosongkan untuk auto-generate (max 22 karakter). Barcode akan otomatis dibuat dari SKU.</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Gambar Produk (URL)</Label>
                <Input
                  value={form.image}
                  onChange={(e) => updateField('image', e.target.value)}
                  placeholder="Opsional — https://..."
                  className="bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 h-10 text-sm rounded-lg focus-visible:theme-ring focus-visible:theme-border"
                />
                {form.image.trim() && (
                  <div className="relative group rounded-xl overflow-hidden border border-white/[0.06] bg-nebula mt-2">
                    <div
                      className="relative w-full aspect-square max-w-[160px] bg-white/[0.02] flex items-center justify-center overflow-hidden"
                    >
                      { }
                      <img
                        src={form.image.trim()}
                        alt="Preview"
                        className="w-full h-full object-contain p-2"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                          ;(e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden')
                        }}
                        onLoad={(e) => {
                          (e.target as HTMLImageElement).style.display = 'block'
                          ;(e.target as HTMLImageElement).nextElementSibling?.classList.add('hidden')
                        }}
                      />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 hidden">
                        <Package className="h-6 w-6 text-slate-700" strokeWidth={1.5} />
                        <span className="text-[10px] text-slate-600">Gagal memuat gambar</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateField('image', '')}
                      className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-black/50 backdrop-blur-sm text-white/70 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <Separator className="bg-white/[0.04]" />

            {/* ========== SECTION: Harga & Stok (non-variant mode) ========== */}
            {!hasVariants && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-1 rounded-full theme-bg-light" />
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Harga & Stok</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-300 font-medium">
                      Harga Jual <span className="text-red-400">*</span>
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-medium">Rp</span>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={form.price}
                        onChange={(e) => updateField('price', e.target.value)}
                        placeholder="0"
                        required
                        className="bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 h-10 text-sm rounded-lg pl-8 focus-visible:theme-ring focus-visible:theme-border"
                      />
                    </div>
                  </div>

                  {isOwner && !hasComposition && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-400">
                        HPP <span className="text-slate-600">(Modal)</span>
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-medium">Rp</span>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={form.hpp}
                          onChange={(e) => updateField('hpp', e.target.value)}
                          placeholder="0"
                          className="bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 h-10 text-sm rounded-lg pl-8 focus-visible:theme-ring focus-visible:theme-border"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Profit preview */}
                {isOwner && form.price && Number(form.price) > 0 && (
                  <div className="bg-nebula/80 border border-white/[0.06] rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">
                        {hasComposition ? 'Estimasi Keuntungan (Auto HPP)' : 'Estimasi Keuntungan'}
                      </span>
                      <span className="text-sm font-semibold theme-text">
                        {formatCurrency(Number(form.price) - (hasComposition ? autoHpp : Number(form.hpp) || 0))}
                      </span>
                    </div>
                    {(hasComposition ? autoHpp > 0 : Number(form.hpp) > 0) && (
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-slate-600">Margin</span>
                        <span className="text-[11px] text-slate-400">
                          {(((Number(form.price) - (hasComposition ? autoHpp : Number(form.hpp) || 0)) / Number(form.price)) * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-300 font-medium">
                      Stok Awal <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.stock}
                      onChange={(e) => updateField('stock', e.target.value)}
                      placeholder="0"
                      required
                      className={cn(
                        "bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 h-10 text-sm rounded-lg focus-visible:theme-ring focus-visible:theme-border",
                        hasComposition && maxStockFromComposition !== Infinity && Number(form.stock) > maxStockFromComposition && "border-amber-500/50"
                      )}
                    />
                    {hasComposition && maxStockFromComposition !== Infinity && (
                      <p className={cn(
                        "text-[10px]",
                        Number(form.stock) > maxStockFromComposition ? "text-amber-400" : "text-slate-600"
                      )}>
                        Maks. {maxStockFromComposition} {form.unit || 'pcs'} (berdasarkan stok item)
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-400">
                      Peringatan Stok Rendah
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.lowStockAlert}
                      onChange={(e) => updateField('lowStockAlert', e.target.value)}
                      placeholder="10"
                      className="bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 h-10 text-sm rounded-lg focus-visible:theme-ring focus-visible:theme-border"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ========== SECTION: Variant Toggle ========== */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full theme-bg-light" />
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Varian Produk</span>
              </div>

              <div
                className={`rounded-xl border p-4 transition-all duration-200 cursor-pointer ${
                  hasVariants
                    ? 'theme-bg-ultra-light theme-border-medium ring-1 theme-ring'
                    : 'bg-nebula/40 border-white/[0.06] hover:border-white/[0.08]'
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
                      hasVariants ? 'theme-bg-lighter' : 'bg-white/[0.04]'
                    }`}>
                      <Layers className={`h-4 w-4 transition-colors ${hasVariants ? 'theme-text' : 'text-slate-500'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Aktifkan Varian</p>
                      <p className="text-[11px] text-slate-500">
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
                    <div className="bg-nebula/80 border border-white/[0.06] rounded-lg p-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        <Layers className="h-3 w-3 text-slate-500" />
                        <span className="text-[10px] text-slate-500">Varian</span>
                      </div>
                      <p className="text-sm font-bold text-slate-200">{variantSummary.filledCount}</p>
                    </div>
                    <div className="bg-nebula/80 border border-white/[0.06] rounded-lg p-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        <Package className="h-3 w-3 text-slate-500" />
                        <span className="text-[10px] text-slate-500">Total Stok</span>
                      </div>
                      <p className="text-sm font-bold text-slate-200">{formatNumber(variantSummary.totalStock)}</p>
                    </div>
                    <div className="bg-nebula/80 border border-white/[0.06] rounded-lg p-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        <DollarSign className="h-3 w-3 text-slate-500" />
                        <span className="text-[10px] text-slate-500">Harga</span>
                      </div>
                      <p className="text-sm font-bold text-slate-200">
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
                  <div className="rounded-xl border border-dashed border-white/[0.06] bg-nebula/30 p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Copy className="h-3.5 w-3.5 text-slate-500" />
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Isi Massal Varian</span>
                      </div>
                      {(massFill.price || massFill.hpp || massFill.stock) && (
                        <button
                          type="button"
                          onClick={clearMassFill}
                          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-600 leading-relaxed">
                      Isi untuk menerapkan harga{!hasComposition ? ', HPP, ' : ' dan '}stok yang sama ke <strong>semua varian sekaligus</strong>. Kosongkan field yang tidak ingin diubah.
                    </p>
                    <div className={cn("grid gap-2", hasComposition ? "grid-cols-2" : "grid-cols-3")}>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500">Harga Jual</Label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-600">Rp</span>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={massFill.price}
                            onChange={(e) => setMassFill((p) => ({ ...p, price: e.target.value }))}
                            placeholder="Kosongkan"
                            className="bg-white/[0.04] border-white/[0.06] text-slate-200 placeholder:text-zinc-700 h-8 text-[11px] rounded-md pl-6 focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
                          />
                        </div>
                      </div>
                      {isOwner && !hasComposition && (
                        <div className="space-y-1">
                          <Label className="text-[10px] text-slate-500">HPP (Modal)</Label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-600">Rp</span>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={massFill.hpp}
                              onChange={(e) => setMassFill((p) => ({ ...p, hpp: e.target.value }))}
                              placeholder="Kosongkan"
                              className="bg-white/[0.04] border-white/[0.06] text-slate-200 placeholder:text-zinc-700 h-8 text-[11px] rounded-md pl-6 focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
                            />
                          </div>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500">Stok</Label>
                        <Input
                          type="number"
                          min="0"
                          value={massFill.stock}
                          onChange={(e) => setMassFill((p) => ({ ...p, stock: e.target.value }))}
                          placeholder="Kosongkan"
                          className="bg-white/[0.04] border-white/[0.06] text-slate-200 placeholder:text-zinc-700 h-8 text-[11px] rounded-md focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
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
                  <Label className="text-xs text-slate-400">
                    Peringatan Stok Rendah
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.lowStockAlert}
                    onChange={(e) => updateField('lowStockAlert', e.target.value)}
                    placeholder="10"
                    className="bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 h-10 text-sm rounded-lg focus-visible:theme-ring focus-visible:theme-border"
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
                    const effectiveHpp = hasComposition ? getVariantAutoHpp(index) : vHpp

                    return (
                      <div
                        key={index}
                        className={`rounded-xl border transition-all duration-150 overflow-hidden ${
                          isExpanded
                            ? 'bg-nebula border-white/[0.06] ring-1 ring-white/[0.06]'
                            : 'bg-nebula/40 border-white/[0.06] hover:border-white/[0.06]'
                        }`}
                      >
                        {/* Collapsed header */}
                        <div
                          className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer"
                          onClick={() => toggleVariantExpand(index)}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                              hasName ? 'theme-bg-very-light theme-text' : 'bg-white/[0.04] text-slate-600'
                            }`}>
                              {hasName ? variant.name.charAt(0).toUpperCase() : index + 1}
                            </div>
                            <div className="min-w-0">
                              <p className={`text-xs font-medium truncate ${hasName ? 'text-slate-200' : 'text-slate-600'}`}>
                                {hasName ? variant.name : `Varian ${index + 1}`}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {vPrice > 0 && (
                                  <span className="text-[10px] text-slate-500">{formatCurrency(vPrice)}</span>
                                )}
                                <span className="text-[10px] text-slate-600">Stok: {formatNumber(vStock)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isOwner && vPrice > 0 && effectiveHpp > 0 && (
                              <Badge className="theme-bg-very-light theme-border-light theme-text text-[9px] px-1.5 py-0 mr-1">
                                +{formatCurrency(vPrice - effectiveHpp)}
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
                              className="h-6 w-6 p-0 text-slate-600 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                            )}
                          </div>
                        </div>

                        {/* Expanded form */}
                        {isExpanded && (
                          <div className="px-3.5 pb-3.5 pt-1 border-t border-white/[0.06] space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-slate-400 font-medium">
                                Nama Varian <span className="text-red-400">*</span>
                              </Label>
                              <Input
                                value={variant.name}
                                onChange={(e) => updateVariant(index, 'name', e.target.value)}
                                placeholder="Contoh: Small, Medium, Large"
                                className="bg-white/[0.05] border-white/[0.08] text-white placeholder:text-slate-600 h-9 text-xs rounded-lg focus-visible:theme-ring focus-visible:theme-border"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-slate-500">SKU Varian</Label>
                              <Input
                                value={variant.sku}
                                onChange={(e) => updateVariant(index, 'sku', e.target.value)}
                                placeholder="Opsional"
                                className="bg-white/[0.05] border-white/[0.08] text-white placeholder:text-slate-600 h-9 text-xs rounded-lg focus-visible:theme-ring focus-visible:theme-border"
                              />
                            </div>

                            <div className={cn("grid gap-2", hasComposition && isOwner ? "grid-cols-2" : "grid-cols-3")}>
                              {isOwner && !hasComposition && (
                                <div className="space-y-1.5">
                                  <Label className="text-[10px] text-slate-500">HPP (Modal)</Label>
                                  <div className="relative">
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-600">Rp</span>
                                    <Input
                                      type="number"
                                      min="0"
                                      step="any"
                                      value={variant.hpp}
                                      onChange={(e) => updateVariant(index, 'hpp', e.target.value)}
                                      placeholder="0"
                                      className="bg-white/[0.05] border-white/[0.08] text-white placeholder:text-slate-600 h-9 text-xs rounded-lg pl-7 focus-visible:theme-ring focus-visible:theme-border"
                                    />
                                  </div>
                                </div>
                              )}
                              {isOwner && hasComposition && (
                                <div className="space-y-1.5">
                                  <Label className="text-[10px] text-slate-500">HPP (Auto)</Label>
                                  <div className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2.5 h-9 flex items-center justify-between">
                                    <span className="text-[11px] text-slate-600">dari komposisi</span>
                                    <span className="text-xs font-medium theme-text">{formatCurrency(getVariantAutoHpp(index))}</span>
                                  </div>
                                </div>
                              )}
                              <div className="space-y-1.5">
                                <Label className="text-[10px] text-slate-400 font-medium">
                                  Harga Jual <span className="text-red-400">*</span>
                                </Label>
                                <div className="relative">
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-600">Rp</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={variant.price}
                                    onChange={(e) => updateVariant(index, 'price', e.target.value)}
                                    placeholder="0"
                                    className="bg-white/[0.05] border-white/[0.08] text-white placeholder:text-slate-600 h-9 text-xs rounded-lg pl-7 focus-visible:theme-ring focus-visible:theme-border"
                                  />
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-[10px] text-slate-500">Stok</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  value={variant.stock}
                                  onChange={(e) => updateVariant(index, 'stock', e.target.value)}
                                  placeholder="0"
                                  className={cn(
                                    "bg-white/[0.05] border-white/[0.08] text-white placeholder:text-slate-600 h-9 text-xs rounded-lg focus-visible:theme-ring focus-visible:theme-border",
                                    hasComposition && getVariantMaxStock(index) !== Infinity && Number(variant.stock) > getVariantMaxStock(index) && "border-amber-500/50"
                                  )}
                                />
                                {hasComposition && getVariantMaxStock(index) !== Infinity && (
                                  <p className={cn("text-[9px]", Number(variant.stock) > getVariantMaxStock(index) ? "text-amber-400" : "text-slate-600")}>
                                    Maks. {getVariantMaxStock(index)}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Variant profit preview */}
                            {isOwner && vPrice > 0 && (hasComposition ? getVariantAutoHpp(index) > 0 : vHpp > 0) && (
                              <div className="bg-white/[0.03] rounded-lg p-2 flex items-center justify-between">
                                <span className="text-[10px] text-slate-500">Keuntungan</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-medium theme-text">{formatCurrency(vPrice - effectiveHpp)}</span>
                                  <span className="text-[10px] text-slate-600">
                                    ({(((vPrice - effectiveHpp) / vPrice) * 100).toFixed(1)}%)
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Per-variant composition section */}
                            {hasComposition && (
                              <div className="space-y-2 pt-2 border-t border-white/[0.04]">
                                <div className="flex items-center gap-1.5">
                                  <Beaker className="h-3 w-3 text-slate-500" />
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Komposisi Varian</span>
                                </div>

                                {/* Auto HPP per variant */}
                                <div className="bg-white/[0.03] border border-white/[0.04] rounded-lg p-2 flex items-center justify-between">
                                  <span className="text-[10px] text-slate-600">HPP otomatis</span>
                                  <span className="text-[11px] font-medium theme-text">{formatCurrency(getVariantAutoHpp(index))}</span>
                                </div>

                                {/* Composition items for this variant */}
                                {(variantCompositions[index] || []).map((comp, cIdx) => (
                                  <div key={comp.inventoryItemId} className="bg-white/[0.03] border border-white/[0.04] rounded-lg p-2 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] text-slate-300 truncate">{comp.inventoryItemName}</span>
                                      <button type="button" onClick={() => removeVariantComposition(index, cIdx)} className="text-slate-600 hover:text-red-400">
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <Input type="number" min="0" step="any" value={comp.qty}
                                        onChange={(e) => updateVariantCompositionQty(index, cIdx, e.target.value)}
                                        placeholder="0"
                                        className="flex-1 h-7 text-[11px] bg-white/[0.04] border-white/[0.06] text-white rounded-md px-2 focus-visible:theme-ring focus-visible:theme-border"
                                      />
                                      <span className="text-[10px] text-slate-500 w-10 text-right">{comp.baseUnit}</span>
                                    </div>
                                    {Number(comp.qty) > 0 && comp.avgCost > 0 && (
                                      <div className="text-[9px] text-slate-600 text-right">
                                        {Number(comp.qty)} × {formatCurrency(comp.avgCost)} = {formatCurrency(Number(comp.qty) * comp.avgCost)}
                                      </div>
                                    )}
                                  </div>
                                ))}

                                {/* Add ingredient dropdown for this variant */}
                                <select value="" onChange={(e) => { if (e.target.value) { addVariantComposition(index, e.target.value); e.target.value = '' } }}
                                  className="w-full h-8 text-[11px] bg-white/[0.04] border border-white/[0.06] text-white rounded-lg px-2 focus:outline-none focus:ring-1 focus:theme-ring appearance-none cursor-pointer">
                                  <option value="" disabled>+ Tambah item...</option>
                                  {inventoryItems
                                    .filter((item) => !(variantCompositions[index] || []).some((c) => c.inventoryItemId === item.id))
                                    .map((item) => (
                                      <option key={item.id} value={item.id}>{item.name} (stok: {formatNumber(item.stock)} {item.baseUnit})</option>
                                    ))
                                  }
                                </select>

                                {/* Stock capacity warning */}
                                {getVariantMaxStock(index) !== Infinity && (
                                  <p className="text-[9px] text-amber-400/80">
                                    Maks. {getVariantMaxStock(index)} unit dari stok item
                                  </p>
                                )}
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
                  className="w-full h-10 border-dashed border-white/[0.06] text-slate-400 hover:theme-text hover:theme-border-light hover:theme-hover-light text-xs rounded-lg"
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

            <Separator className="bg-white/[0.04]" />

            {/* ========== SECTION: Komposisi ========== */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full theme-bg-light" />
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Komposisi</span>
              </div>

              <div
                className={`rounded-xl border p-4 transition-all duration-200 cursor-pointer ${
                  hasComposition
                    ? 'theme-bg-ultra-light theme-border-medium ring-1 theme-ring'
                    : 'bg-nebula/40 border-white/[0.06] hover:border-white/[0.08]'
                }`}
                onClick={() => {
                  if (!hasComposition) setHasComposition(true)
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
                      hasComposition ? 'theme-bg-lighter' : 'bg-white/[0.04]'
                    }`}>
                      <Beaker className={`h-4 w-4 transition-colors ${hasComposition ? 'theme-text' : 'text-slate-500'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">
                        {hasVariants && hasComposition ? 'Komposisi per Varian — aktif' : 'Aktifkan Komposisi'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {hasVariants && hasComposition
                          ? 'Setiap varian memiliki komposisi item sendiri'
                          : hasComposition
                            ? 'HPP dihitung otomatis dari item'
                            : 'Produk dibuat dari item inventory?'
                        }
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={hasComposition}
                    onCheckedChange={(checked) => {
                      setHasComposition(checked)
                      if (!checked) {
                        setCompositions([])
                        setVariantCompositions({})
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            </div>

            {/* Composition section — variant mode (info only) */}
            {hasComposition && hasVariants && (
              <div className="space-y-3">
                <div className="flex items-start gap-2.5 bg-sky-500/5 border border-sky-500/15 rounded-lg p-3">
                  <Beaker className="h-3.5 w-3.5 text-sky-400 mt-0.5 flex-shrink-0" />
                  <div className="text-[11px] text-sky-300/80 leading-relaxed">
                    Komposisi diatur <span className="font-medium text-sky-300">per varian</span>. Buka setiap varian untuk mengatur itemnya. Setiap varian memiliki HPP otomatis berdasarkan item yang digunakan.
                  </div>
                </div>
              </div>
            )}

            {/* Composition section — non-variant mode (full editor) */}
            {hasComposition && !hasVariants && (
              <div className="space-y-3">
                {/* Auto HPP display */}
                <div className="bg-nebula/80 border border-white/[0.06] rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Auto HPP (dari komposisi)</span>
                    <span className="text-sm font-semibold theme-text">{formatCurrency(autoHpp)}</span>
                  </div>
                  {compositions.length > 0 && (
                    <p className="text-[10px] text-slate-600 mt-1">
                      {compositions.length} item × qty = HPP per {form.unit || 'pcs'}
                    </p>
                  )}
                </div>

                {/* Composition items */}
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1 custom-scrollbar">
                  {compositions.map((comp, idx) => (
                    <div key={comp.inventoryItemId} className="bg-nebula border border-white/[0.06] rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-6 w-6 rounded-md bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                            <Beaker className="h-3 w-3 text-emerald-400" />
                          </div>
                          <span className="text-xs font-medium text-slate-200 truncate">{comp.inventoryItemName}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeComposition(idx)}
                          className="h-6 w-6 p-0 text-slate-600 hover:text-red-400 hover:bg-red-500/10"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={comp.qty}
                            onChange={(e) => updateCompositionQty(idx, e.target.value)}
                            placeholder="0"
                            className="bg-white/[0.05] border-white/[0.08] text-white placeholder:text-slate-600 h-9 text-xs rounded-lg focus-visible:theme-ring focus-visible:theme-border"
                          />
                        </div>
                        <span className="text-xs text-slate-400 w-12 text-right flex-shrink-0">{comp.baseUnit}</span>
                      </div>
                      {Number(comp.qty) > 0 && comp.avgCost > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-600">
                            {Number(comp.qty)} {comp.baseUnit} × {formatCurrency(comp.avgCost)}
                          </span>
                          <span className="text-[10px] font-medium text-slate-400">
                            {formatCurrency(Number(comp.qty) * comp.avgCost)}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add ingredient */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-slate-500">Tambah Item</Label>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addComposition(e.target.value)
                      e.target.value = ''
                    }}
                    className="w-full h-10 text-sm bg-nebula border border-white/[0.06] text-white rounded-lg px-3 focus:outline-none focus:ring-1 focus:theme-ring focus:theme-border appearance-none cursor-pointer"
                  >
                    <option value="" disabled>Pilih item...</option>
                    {inventoryItems
                      .filter((item) => !compositions.some((c) => c.inventoryItemId === item.id))
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} (stok: {formatNumber(item.stock)} {item.baseUnit})
                        </option>
                      ))}
                  </select>
                  {inventoryItems.length === 0 && (
                    <p className="text-[10px] text-slate-600">Belum ada item. Tambahkan di halaman Pembelian → Inventory.</p>
                  )}
                </div>

                {/* Info note */}
                <div className="flex items-start gap-2.5 bg-sky-500/5 border border-sky-500/15 rounded-lg p-3">
                  <Beaker className="h-3.5 w-3.5 text-sky-400 mt-0.5 flex-shrink-0" />
                  <div className="text-[11px] text-sky-300/80 leading-relaxed">
                    Saat komposisi aktif, <span className="font-medium text-sky-300">HPP akan dihitung otomatis</span> dari total biaya item. Setiap penjualan akan mengurangi stok item sesuai komposisi.
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/[0.06] bg-deep-space/80">
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] h-9 text-xs rounded-lg"
            >
              Batal
            </Button>
            <Button
              type="submit"
              onClick={handleSubmit}
              disabled={saving}
              className="theme-bg hover:theme-hover text-white h-9 text-xs font-medium rounded-lg shadow-lg theme-shadow min-w-[100px]"
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