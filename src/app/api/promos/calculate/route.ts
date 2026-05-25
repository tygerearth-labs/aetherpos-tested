import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'

interface CartItem {
  productId: string
  productName: string
  price: number
  qty: number
  subtotal: number
  categoryId?: string | null
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const body = await request.json()
    const { items, subtotal } = body as { items: CartItem[]; subtotal: number }

    if (!items || items.length === 0) {
      return safeJson({ applicablePromo: null, discount: 0, total: subtotal })
    }

    // Fetch all active promos for this outlet
    const promos = await db.promo.findMany({
      where: { outletId: user.outletId, active: true },
    })

    let bestPromo: { id: string; name: string; type: string; discount: number; description: string } | null = null
    let bestDiscount = 0

    const totalItems = items.reduce((sum, i) => sum + i.qty, 0)

    for (const promo of promos) {
      let discount = 0

      // Check category filter
      if (promo.categoryId) {
        const hasCategoryMatch = items.some(item => item.categoryId === promo.categoryId)
        if (!hasCategoryMatch) continue
      }

      // Calculate applicable subtotal based on category filter
      let applicableSubtotal = subtotal
      if (promo.categoryId) {
        applicableSubtotal = items
          .filter(item => item.categoryId === promo.categoryId)
          .reduce((sum, item) => sum + item.subtotal, 0)
      }

      // Calculate applicable item count based on category filter
      let applicableItemCount = totalItems
      if (promo.categoryId) {
        applicableItemCount = items
          .filter(item => item.categoryId === promo.categoryId)
          .reduce((sum, item) => sum + item.qty, 0)
      }

      if (promo.type === 'PERCENTAGE') {
        // Check min purchase
        if (promo.minPurchase && subtotal < promo.minPurchase) continue
        discount = applicableSubtotal * (promo.value / 100)
        if (promo.maxDiscount && discount > promo.maxDiscount) {
          discount = promo.maxDiscount
        }
      } else if (promo.type === 'NOMINAL') {
        // Check min purchase
        if (promo.minPurchase && subtotal < promo.minPurchase) continue
        discount = promo.value
        if (discount > applicableSubtotal) discount = applicableSubtotal
      } else if (promo.type === 'BUY_X_GET_DISCOUNT') {
        // Check minimum item quantity
        const minQty = promo.buyMinQty || 2
        if (applicableItemCount < minQty) continue
        // Check min purchase
        if (promo.minPurchase && subtotal < promo.minPurchase) continue

        if (promo.discountType === 'PERCENTAGE') {
          discount = applicableSubtotal * (promo.value / 100)
          if (promo.maxDiscount && discount > promo.maxDiscount) {
            discount = promo.maxDiscount
          }
        } else {
          // NOMINAL discount
          discount = promo.value
          if (discount > applicableSubtotal) discount = applicableSubtotal
        }
      }

      if (discount > bestDiscount) {
        bestDiscount = discount
        const desc = promo.type === 'BUY_X_GET_DISCOUNT'
          ? `Beli ${promo.buyMinQty || 2} item, diskon ${promo.discountType === 'PERCENTAGE' ? `${promo.value}%` : `Rp ${promo.value.toLocaleString('id-ID')}`}`
          : promo.type === 'PERCENTAGE'
            ? `Diskon ${promo.value}%`
            : `Diskon Rp ${promo.value.toLocaleString('id-ID')}`

        bestPromo = {
          id: promo.id,
          name: promo.name,
          type: promo.type,
          discount,
          description: desc,
        }
      }
    }

    return safeJson({
      applicablePromo: bestPromo,
      discount: bestDiscount,
      total: Math.max(0, subtotal - bestDiscount),
    })
  } catch (error) {
    console.error('Promo calculate error:', error)
    return safeJsonError('Failed to calculate promo', 500)
  }
}
