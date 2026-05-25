import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { sendTelegramMessage } from '@/lib/telegram'
import { safeJson, safeJsonError } from '@/lib/safe-response'

const TELEGRAM_API = 'https://api.telegram.org'

/**
 * POST /api/telegram/setup
 *
 * Accepts:
 * - { chatId } — link Telegram (legacy flow)
 * - { action: "test", botToken, chatId } — test connection with custom bot token
 *
 * IMPORTANT: After a successful test, botToken + chatId are auto-saved to DB
 * so that notifications work immediately without requiring a separate "Save".
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat mengatur notifikasi', 403)
    }

    const body = await request.json()

    // Test connection mode
    if (body.action === 'test') {
      const { botToken, chatId } = body as { botToken?: string; chatId?: string }

      if (!botToken || typeof botToken !== 'string') {
        return safeJsonError('Bot Token wajib diisi', 400)
      }

      // Step 1: Validate bot token by calling getMe
      let botInfo: { id: number; first_name: string; username?: string } | null = null
      try {
        const meRes = await fetch(`${TELEGRAM_API}/bot${botToken}/getMe`)
        const meData = await meRes.json() as { ok: boolean; result?: { id: number; first_name: string; username?: string }; description?: string }

        if (!meData.ok || !meData.result) {
          return safeJsonError(`Bot Token tidak valid: ${meData.description || 'Unknown error'}`, 400)
        }
        botInfo = meData.result
      } catch (err) {
        return safeJsonError(`Gagal terhubung ke Telegram API: ${err instanceof Error ? err.message : 'Unknown error'}`, 400)
      }

      // Step 2: If chatId provided, send test message
      if (chatId && typeof chatId === 'string') {
        const testText = `✅ <b>Telegram Notifikasi Terhubung!</b>\n\n🏪 Aether POS\n🤖 Bot: @${botInfo.username || botInfo.first_name}\n👋 Halo ${user.name}, notifikasi akan dikirim ke chat ini.\n\nKamu akan menerima:\n• Notifikasi transaksi baru\n• Notifikasi customer baru\n• Laporan harian & bulanan\n\n⚙️ Atur jenis notifikasi di halaman Pengaturan.`

        try {
          const sendRes = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: testText,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          })
          const sendData = await sendRes.json() as { ok: boolean; description?: string }

          if (!sendData.ok) {
            return safeJsonError(`Bot valid tapi gagal mengirim pesan ke Chat ID ${chatId}: ${sendData.description || 'Pastikan Chat ID benar dan bot telah di-start'}`, 400)
          }
        } catch (err) {
          return safeJsonError(`Bot valid tapi gagal mengirim pesan: ${err instanceof Error ? err.message : 'Unknown error'}`, 400)
        }

        // ============================================================
        // AUTO-SAVE: Persist botToken + chatId to DB after successful test
        // This fixes the bug where test works but notifications don't
        // (because values were only in request body, not in DB)
        // ============================================================
        let autoSaved = false
        let saveError: string | null = null
        try {
          await db.outletSetting.upsert({
            where: { outletId: user.outletId },
            create: {
              outletId: user.outletId,
              telegramChatId: chatId,
              telegramBotToken: botToken,
            },
            update: {
              telegramChatId: chatId,
              telegramBotToken: botToken,
            },
          })
          autoSaved = true
          console.log(`[telegram/setup] ✅ Auto-saved botToken & chatId for outlet ${user.outletId} (chatId: ${chatId})`)
        } catch (saveErr) {
          saveError = saveErr instanceof Error ? saveErr.message : 'Unknown save error'
          console.error('[telegram/setup] ❌ Failed to auto-save Telegram config:', saveErr)
        }

        // Verify saved data by reading back from DB
        if (autoSaved) {
          try {
            const verify = await db.outletSetting.findUnique({
              where: { outletId: user.outletId },
              select: { telegramChatId: true, telegramBotToken: true },
            })
            if (!verify?.telegramBotToken || !verify?.telegramChatId) {
              autoSaved = false
              saveError = `Verify failed: DB has chatId=${!!verify?.telegramChatId}, botToken=${!!verify?.telegramBotToken}`
              console.error(`[telegram/setup] ❌ Auto-save verify failed: ${saveError}`)
            } else {
              console.log(`[telegram/setup] ✅ Verify OK: chatId=${verify.telegramChatId}, botToken=***${verify.telegramBotToken.slice(-4)}`)
            }
          } catch (verifyErr) {
            console.error('[telegram/setup] Verify query failed:', verifyErr)
          }
        }
      }

      return safeJson({
        success: true,
        message: chatId
          ? (autoSaved ? 'Koneksi berhasil! Pesan tes terkirim & tersimpan otomatis.' : `⚠️ Pesan tes terkirim, tapi gagal menyimpan: ${saveError}`)
          : 'Bot Token valid!',
        autoSaved,
        botInfo: {
          id: botInfo.id,
          name: botInfo.first_name,
          username: botInfo.username || null,
        },
      })
    }

    // Legacy flow: link chatId only
    const { chatId } = body as { chatId?: string }

    if (!chatId || typeof chatId !== 'string') {
      return safeJsonError('chatId wajib diisi (string)', 400)
    }

    // Validate by sending a test message
    const testResult = await sendTelegramMessage(
      chatId,
      `✅ <b>Telegram Notifikasi Terhubung!</b>\n\n🏪 Aether POS\n👋 Halo ${user.name}, notifikasi akan dikirim ke chat ini.\n\nKamu akan menerima:\n• Notifikasi transaksi baru\n• Notifikasi customer baru\n• Laporan harian & bulanan\n\n⚙️ Atur jenis notifikasi di halaman Pengaturan.`
    )

    if (!testResult.ok) {
      return safeJsonError(`Gagal mengirim test message: ${testResult.error}`, 400)
    }

    // Save chatId to outlet settings
    await db.outletSetting.upsert({
      where: { outletId: user.outletId },
      create: { outletId: user.outletId, telegramChatId: chatId },
      update: { telegramChatId: chatId },
    })

    return safeJson({
      success: true,
      message: 'Telegram berhasil terhubung',
      chatId,
      testMessageId: testResult.messageId,
    })
  } catch (error) {
    console.error('[/api/telegram/setup] Error:', error)
    return safeJsonError('Internal server error')
  }
}

/**
 * DELETE /api/telegram/setup
 *
 * Unlink Telegram notifications.
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat mengatur notifikasi', 403)
    }

    await db.outletSetting.update({
      where: { outletId: user.outletId },
      data: { telegramChatId: null, telegramBotToken: null },
    })

    return safeJson({
      success: true,
      message: 'Telegram notifikasi terputus',
    })
  } catch (error) {
    console.error('[/api/telegram/setup] Error:', error)
    return safeJsonError('Internal server error')
  }
}
