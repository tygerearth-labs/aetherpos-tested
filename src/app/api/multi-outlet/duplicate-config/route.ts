import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLog } from '@/lib/safe-audit'

/**
 * POST /api/multi-outlet/duplicate-config
 *
 * Duplicate configuration (OutletSetting, Categories, Products) from the
 * caller's main outlet to a target branch outlet.
 *
 * Body: { targetOutletId: string }
 *
 * Conditions:
 * - User must be OWNER
 * - User's outlet must be the MAIN outlet in a group
 * - Target outlet must be in the same group
 * - Target outlet must NOT be the main outlet itself
 *
 * Copies:
 * - OutletSetting (payment methods, loyalty, receipt, theme, PPN, telegram, etc.)
 * - Categories (name, color)
 * - Products (name, SKU, barcode, HPP, price, stock reset to 0, categories mapped by name)
 *
 * Does NOT copy: transactions, customers, users, audit logs, promos.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Hanya owner yang dapat menduplikat konfigurasi', 403)

    const body = await request.json()
    const { targetOutletId } = body

    if (!targetOutletId) {
      return safeJsonError('targetOutletId wajib diisi', 400)
    }

    // ── Validate: user's outlet is MAIN, both in same group ──
    const [currentUserOutlet, targetOutlet] = await Promise.all([
      db.outlet.findUnique({
        where: { id: user.outletId },
        select: { id: true, name: true, groupId: true, isMain: true },
      }),
      db.outlet.findUnique({
        where: { id: targetOutletId },
        select: { id: true, name: true, groupId: true, isMain: true },
      }),
    ])

    if (!currentUserOutlet) return safeJsonError('Outlet Anda tidak ditemukan', 404)
    if (!currentUserOutlet.isMain) return safeJsonError('Hanya outlet utama yang dapat menduplikat konfigurasi', 403)
    if (!currentUserOutlet.groupId) return safeJsonError('Outlet Anda belum tergabung dalam grup', 400)
    if (!targetOutlet) return safeJsonError('Outlet target tidak ditemukan', 404)
    if (currentUserOutlet.groupId !== targetOutlet.groupId) return safeJsonError('Outlet target bukan dalam grup yang sama', 403)
    if (targetOutlet.isMain) return safeJsonError('Tidak dapat menduplikat ke outlet utama', 400)
    if (currentUserOutlet.id === targetOutletId) return safeJsonError('Tidak dapat menduplikat ke outlet sendiri', 400)

    const mainOutletId = currentUserOutlet.id

    // ── Fetch source data ──
    const [sourceSetting, sourceCategories, sourceProducts] = await Promise.all([
      // OutletSetting
      db.outletSetting.findUnique({
        where: { outletId: mainOutletId },
      }),
      // Categories
      db.category.findMany({
        where: { outletId: mainOutletId },
        select: { id: true, name: true, color: true },
      }),
      // Products with category info
      db.product.findMany({
        where: { outletId: mainOutletId },
        include: {
          category: {
            select: { name: true },
          },
        },
      }),
    ])

    // ── Execute duplication in a transaction ──
    const result = await db.$transaction(async (tx) => {
      // 1. Duplicate OutletSetting (upsert — replace existing)
      if (sourceSetting) {
        const settingData: Record<string, unknown> = {
          paymentMethods: sourceSetting.paymentMethods,
          loyaltyEnabled: sourceSetting.loyaltyEnabled,
          loyaltyPointsPerAmount: sourceSetting.loyaltyPointsPerAmount,
          loyaltyPointValue: sourceSetting.loyaltyPointValue,
          receiptBusinessName: sourceSetting.receiptBusinessName,
          receiptAddress: sourceSetting.receiptAddress,
          receiptPhone: sourceSetting.receiptPhone,
          receiptFooter: sourceSetting.receiptFooter,
          receiptLogo: sourceSetting.receiptLogo,
          ppnEnabled: sourceSetting.ppnEnabled,
          ppnRate: sourceSetting.ppnRate,
          manualDiscountEnabled: sourceSetting.manualDiscountEnabled,
          receiptDoublePrintEnabled: sourceSetting.receiptDoublePrintEnabled,
          receiptMerchantCopyEnabled: sourceSetting.receiptMerchantCopyEnabled,
          receiptCustomerCopyEnabled: sourceSetting.receiptCustomerCopyEnabled,
          receiptBatchOrderEnabled: sourceSetting.receiptBatchOrderEnabled,
          themePrimaryColor: sourceSetting.themePrimaryColor,
          telegramBotToken: sourceSetting.telegramBotToken,
          telegramChatId: sourceSetting.telegramChatId,
          notifyOnTransaction: sourceSetting.notifyOnTransaction,
          notifyOnCustomer: sourceSetting.notifyOnCustomer,
          notifyDailyReport: sourceSetting.notifyDailyReport,
          notifyWeeklyReport: sourceSetting.notifyWeeklyReport,
          notifyMonthlyReport: sourceSetting.notifyMonthlyReport,
          notifyOnInsight: sourceSetting.notifyOnInsight,
        }

        await tx.outletSetting.upsert({
          where: { outletId: targetOutletId },
          create: { outletId: targetOutletId, ...settingData },
          update: settingData,
        })
      }

      // 2. Duplicate Categories (name + color), build name→newId map
      // Delete existing categories at target first (will cascade to products' categoryId → setNull)
      const existingTargetCategories = await tx.category.findMany({
        where: { outletId: targetOutletId },
        select: { id: true },
      })
      if (existingTargetCategories.length > 0) {
        // Delete existing products first (they reference categories)
        await tx.product.deleteMany({ where: { outletId: targetOutletId } })
        await tx.category.deleteMany({ where: { outletId: targetOutletId } })
      }

      const categoryNameToId: Record<string, string> = {}
      for (const cat of sourceCategories) {
        const created = await tx.category.create({
          data: {
            name: cat.name,
            color: cat.color,
            outletId: targetOutletId,
          },
        })
        categoryNameToId[cat.name] = created.id
      }

      // 3. Duplicate Products (name, SKU, barcode, HPP, price, stock=0, category mapped by name)
      let productsCreated = 0
      for (const product of sourceProducts) {
        const targetCategoryId = product.category?.name
          ? categoryNameToId[product.category.name]
          : null

        await tx.product.create({
          data: {
            name: product.name,
            sku: product.sku,
            barcode: product.barcode,
            hpp: product.hpp,
            price: product.price,
            bruto: product.bruto,
            netto: product.netto,
            stock: 0, // Always reset stock to 0
            lowStockAlert: product.lowStockAlert,
            unit: product.unit,
            image: product.image,
            categoryId: targetCategoryId,
            outletId: targetOutletId,
            hasVariants: product.hasVariants,
          },
        })
        productsCreated++
      }

      return {
        categoriesCopied: sourceCategories.length,
        productsCopied: productsCreated,
        settingsCopied: !!sourceSetting,
      }
    })

    // ── Audit log at target outlet ──
    await safeAuditLog({
      action: 'UPDATE',
      entityType: 'OUTLET',
      entityId: targetOutletId,
      details: JSON.stringify({
        type: 'DUPLICATE_CONFIG',
        fromOutlet: mainOutletId,
        fromOutletName: currentUserOutlet.name,
        toOutlet: targetOutletId,
        toOutletName: targetOutlet.name,
        ...result,
      }),
      outletId: targetOutletId,
      userId: user.id,
    })

    return safeJsonCreated({
      message: `Konfigurasi berhasil diduplikasi dari "${currentUserOutlet.name}" ke "${targetOutlet.name}"`,
      from: currentUserOutlet.name,
      to: targetOutlet.name,
      ...result,
    })
  } catch (error) {
    console.error('[/api/multi-outlet/duplicate-config] POST error:', error)
    return safeJsonError('Gagal menduplikat konfigurasi. Pastikan tidak ada produk dengan nama yang sama di outlet target.', 500)
  }
}