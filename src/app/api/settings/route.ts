import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { db } from '@/lib/db'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/safe-response'

// GET /api/settings - fetch outlet settings + outlet info
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  try {
    let setting = await db.outletSetting.findUnique({
      where: { outletId: user.outletId },
      include: { outlet: true },
    })

    // Auto-create if not exists
    if (!setting) {
      setting = await db.outletSetting.create({
        data: { outletId: user.outletId },
        include: { outlet: true },
      })
    }

    return safeJson({
      id: setting.id,
      outletId: setting.outletId,
      paymentMethods: setting.paymentMethods,
      loyaltyEnabled: setting.loyaltyEnabled,
      loyaltyPointsPerAmount: setting.loyaltyPointsPerAmount,
      loyaltyPointValue: setting.loyaltyPointValue,
      receiptBusinessName: setting.receiptBusinessName,
      receiptAddress: setting.receiptAddress,
      receiptPhone: setting.receiptPhone,
      receiptFooter: setting.receiptFooter,
      receiptLogo: setting.receiptLogo,
      ppnEnabled: setting.ppnEnabled,
      ppnRate: setting.ppnRate,
      themePrimaryColor: setting.themePrimaryColor,
      telegramChatId: setting.telegramChatId,
      telegramBotToken: setting.telegramBotToken ? '••••••' : null,
      notifyOnTransaction: setting.notifyOnTransaction,
      notifyOnCustomer: setting.notifyOnCustomer,
      notifyDailyReport: setting.notifyDailyReport,
      notifyWeeklyReport: setting.notifyWeeklyReport,
      notifyMonthlyReport: setting.notifyMonthlyReport,
      notifyOnInsight: setting.notifyOnInsight,
      outlet: setting.outlet
        ? {
            id: setting.outlet.id,
            name: setting.outlet.name,
            address: setting.outlet.address,
            phone: setting.outlet.phone,
          }
        : null,
    })
  } catch (error) {
    console.error('GET /api/settings error:', error)
    return safeJsonError('Internal server error', 500)
  }
}

// PUT /api/settings — update outlet settings
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  // Only OWNER can update outlet settings
  if (user.role !== 'OWNER') {
    return safeJsonError('Hanya pemilik yang dapat mengakses', 403)
  }

  try {
    const body = await request.json()

    // Coerce types to match Prisma schema expectations
    const loyaltyEnabled = typeof body.loyaltyEnabled === 'boolean' ? body.loyaltyEnabled : undefined
    const loyaltyPointsPerAmountRaw = body.loyaltyPointsPerAmount != null ? Number(body.loyaltyPointsPerAmount) : undefined
    const loyaltyPointValueRaw = body.loyaltyPointValue != null ? Number(body.loyaltyPointValue) : undefined
    if (loyaltyPointsPerAmountRaw !== undefined && isNaN(loyaltyPointsPerAmountRaw)) {
      return safeJsonError('loyaltyPointsPerAmount harus berupa angka', 400)
    }
    if (loyaltyPointValueRaw !== undefined && isNaN(loyaltyPointValueRaw)) {
      return safeJsonError('loyaltyPointValue harus berupa angka', 400)
    }
    const loyaltyPointsPerAmount = loyaltyPointsPerAmountRaw
    const loyaltyPointValue = loyaltyPointValueRaw
    const notifyOnTransaction = typeof body.notifyOnTransaction === 'boolean' ? body.notifyOnTransaction : undefined
    const notifyOnCustomer = typeof body.notifyOnCustomer === 'boolean' ? body.notifyOnCustomer : undefined
    const notifyDailyReport = typeof body.notifyDailyReport === 'boolean' ? body.notifyDailyReport : undefined
    const notifyWeeklyReport = typeof body.notifyWeeklyReport === 'boolean' ? body.notifyWeeklyReport : undefined
    const notifyMonthlyReport = typeof body.notifyMonthlyReport === 'boolean' ? body.notifyMonthlyReport : undefined
    const notifyOnInsight = typeof body.notifyOnInsight === 'boolean' ? body.notifyOnInsight : undefined

    // PPN / Tax fields
    const ppnEnabled = typeof body.ppnEnabled === 'boolean' ? body.ppnEnabled : undefined
    const ppnRateRaw = body.ppnRate != null ? Number(body.ppnRate) : undefined
    if (ppnRateRaw !== undefined && (isNaN(ppnRateRaw) || ppnRateRaw < 0 || ppnRateRaw > 100)) {
      return safeJsonError('ppnRate harus berupa angka antara 0 dan 100', 400)
    }
    const ppnRate = ppnRateRaw

    const settingsData = {
      outletId: user.outletId,
      ...(body.paymentMethods !== undefined && { paymentMethods: String(body.paymentMethods) }),
      ...(loyaltyEnabled !== undefined && { loyaltyEnabled }),
      ...(loyaltyPointsPerAmount !== undefined && { loyaltyPointsPerAmount }),
      ...(loyaltyPointValue !== undefined && { loyaltyPointValue }),
      ...(body.receiptBusinessName !== undefined && { receiptBusinessName: String(body.receiptBusinessName ?? '') }),
      ...(body.receiptAddress !== undefined && { receiptAddress: String(body.receiptAddress ?? '') }),
      ...(body.receiptPhone !== undefined && { receiptPhone: String(body.receiptPhone ?? '') }),
      ...(body.receiptFooter !== undefined && { receiptFooter: String(body.receiptFooter ?? '') }),
      ...(body.receiptLogo !== undefined && { receiptLogo: String(body.receiptLogo ?? '') }),
      ...(ppnEnabled !== undefined && { ppnEnabled }),
      ...(ppnRate !== undefined && { ppnRate }),
      ...(body.themePrimaryColor !== undefined && { themePrimaryColor: String(body.themePrimaryColor) }),
      ...(body.telegramBotToken !== undefined && { telegramBotToken: body.telegramBotToken ? String(body.telegramBotToken) : null }),
      ...(body.telegramChatId !== undefined && { telegramChatId: body.telegramChatId ? String(body.telegramChatId) : null }),
      ...(notifyOnTransaction !== undefined && { notifyOnTransaction }),
      ...(notifyOnCustomer !== undefined && { notifyOnCustomer }),
      ...(notifyDailyReport !== undefined && { notifyDailyReport }),
      ...(notifyWeeklyReport !== undefined && { notifyWeeklyReport }),
      ...(notifyMonthlyReport !== undefined && { notifyMonthlyReport }),
      ...(notifyOnInsight !== undefined && { notifyOnInsight }),
    }

    // Upsert settings
    const setting = await db.outletSetting.upsert({
      where: { outletId: user.outletId },
      create: settingsData,
      update: settingsData,
      include: { outlet: true },
    })

    // Update outlet info if provided
    if (body.outletName !== undefined || body.outletAddress !== undefined || body.outletPhone !== undefined) {
      await db.outlet.update({
        where: { id: user.outletId },
        data: {
          ...(body.outletName !== undefined && { name: body.outletName }),
          ...(body.outletAddress !== undefined && { address: body.outletAddress }),
          ...(body.outletPhone !== undefined && { phone: body.outletPhone }),
        },
      })

      // L5: Audit log for outlet info changes
      const outletChanges: Record<string, { from: unknown; to: unknown }> = {}
      if (body.outletName !== undefined) outletChanges.outletName = { from: setting.outlet?.name || '', to: body.outletName }
      if (body.outletAddress !== undefined) outletChanges.outletAddress = { from: setting.outlet?.address || '', to: body.outletAddress }
      if (body.outletPhone !== undefined) outletChanges.outletPhone = { from: setting.outlet?.phone || '', to: body.outletPhone }
      if (Object.keys(outletChanges).length > 0) {
        await safeAuditLog({
          action: 'UPDATE',
          entityType: 'OUTLET',
          entityId: user.outletId,
          details: JSON.stringify({ changes: outletChanges }),
          outletId: user.outletId,
          userId: user.id,
        })
      }
    }

    // L5: Audit log for settings changes (excluding outlet info, handled above)
    const SETTINGS_KEYS = [
      'paymentMethods', 'loyaltyEnabled', 'loyaltyPointsPerAmount', 'loyaltyPointValue',
      'receiptBusinessName', 'receiptAddress', 'receiptPhone', 'receiptFooter', 'receiptLogo',
      'ppnEnabled', 'ppnRate',
      'themePrimaryColor', 'telegramBotToken', 'telegramChatId',
      'notifyOnTransaction', 'notifyOnCustomer', 'notifyDailyReport', 'notifyWeeklyReport', 'notifyMonthlyReport', 'notifyOnInsight',
    ] as const
    const settingsChanged: Record<string, unknown> = {}
    for (const key of SETTINGS_KEYS) {
      if (body[key] !== undefined) {
        settingsChanged[key] = body[key]
      }
    }
    if (Object.keys(settingsChanged).length > 0) {
      await safeAuditLog({
        action: 'UPDATE',
        entityType: 'SETTINGS',
        entityId: setting.id,
        details: JSON.stringify({ changes: settingsChanged }),
        outletId: user.outletId,
        userId: user.id,
      })
    }

    // Re-fetch with updated outlet — fall back to the upsert result if re-fetch fails
    let updated
    try {
      updated = await db.outletSetting.findUnique({
        where: { outletId: user.outletId },
        include: { outlet: true },
      })
    } catch {
      updated = setting
    }

    const response = updated ?? setting

    return safeJson({
      id: response.id,
      outletId: response.outletId,
      paymentMethods: response.paymentMethods,
      loyaltyEnabled: response.loyaltyEnabled,
      loyaltyPointsPerAmount: response.loyaltyPointsPerAmount,
      loyaltyPointValue: response.loyaltyPointValue,
      receiptBusinessName: response.receiptBusinessName,
      receiptAddress: response.receiptAddress,
      receiptPhone: response.receiptPhone,
      receiptFooter: response.receiptFooter,
      receiptLogo: response.receiptLogo,
      ppnEnabled: response.ppnEnabled,
      ppnRate: response.ppnRate,
      themePrimaryColor: response.themePrimaryColor,
      telegramChatId: response.telegramChatId,
      telegramBotToken: response.telegramBotToken ? '••••••' : null,
      notifyOnTransaction: response.notifyOnTransaction,
      notifyOnCustomer: response.notifyOnCustomer,
      notifyDailyReport: response.notifyDailyReport,
      notifyWeeklyReport: response.notifyWeeklyReport,
      notifyMonthlyReport: response.notifyMonthlyReport,
      notifyOnInsight: response.notifyOnInsight,
      outlet: response.outlet
        ? {
            id: response.outlet.id,
            name: response.outlet.name,
            address: response.outlet.address,
            phone: response.outlet.phone,
          }
        : null,
    })
  } catch (error) {
    console.error('PUT /api/settings error:', error)
    return safeJsonError('Internal server error', 500)
  }
}
