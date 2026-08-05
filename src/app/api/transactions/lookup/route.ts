import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

/**
 * GET /api/transactions/lookup?eventId=<uuid>
 *
 * IDEMPOTENCY STATUS CHECK — the missing half of the checkout safety contract.
 *
 * PROBLEM (false checkout failure → duplicate payment risk):
 *   1. Frontend calls /api/transactions/sync with eventId E.
 *   2. Server's db.$transaction COMMITS (invoice saved, SYNC_DEDUP marker saved).
 *   3. HTTP response is LOST (network blip, client timeout, server hiccup).
 *   4. Frontend's syncOutbox() catches the network error → row stays PENDING.
 *   5. handleCheckout reads row (PENDING, not SYNCED) → shows "Pembayaran gagal".
 *   6. Cashier clicks "Bayar" again → frontend generates a NEW eventId E2.
 *   7. syncOutbox sends BOTH rows. E resolves via DEX-007 (success, original
 *      invoice). E2 creates a SECOND invoice for the same cart → DUPLICATE.
 *
 * FIX:
 *   After an ambiguous sync result, the frontend calls THIS endpoint with the
 *   eventId. If the server finds the SYNC_DEDUP marker (AuditLog row with
 *   action='SYNC_DEDUP', entityId=eventId), the transaction WAS committed —
 *   the frontend marks the row SYNCED and shows "Pembayaran berhasil" instead
 *   of "Pembayaran gagal". No retry → no duplicate.
 *
 *   If the marker is NOT found, the transaction genuinely did not commit —
 *   the frontend can safely show "Pembayaran gagal" and allow retry.
 *
 * CONTRACT:
 *   - found: true  → transaction committed server-side. invoiceNumber + serverId
 *                    are the real references from the committed transaction.
 *   - found: false → transaction NOT committed. Safe to retry.
 *
 * This endpoint is READ-ONLY. It never creates or modifies data.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId

    const eventId = request.nextUrl.searchParams.get('eventId')
    if (!eventId || eventId.length > 100) {
      return safeJsonError('Missing or invalid eventId', 400)
    }

    // The SYNC_DEDUP marker is written as the FIRST statement inside the
    // checkout $transaction (see /api/transactions/sync step 0). If it
    // exists, the transaction committed. If the $transaction rolled back,
    // the marker rolled back too — so absence proves non-commit.
    //
    // Scoped by outletId to prevent cross-outlet IDOR (a cashier at outlet A
    // cannot probe outlet B's eventIds).
    const marker = await db.auditLog.findFirst({
      where: {
        action: 'SYNC_DEDUP',
        entityId: eventId,
        outletId,
      },
      select: { details: true, createdAt: true },
    })

    if (!marker) {
      return safeJson({ found: false })
    }

    // Parse the marker details (written at step 9b of the sync $transaction).
    // The marker starts as { eventId, pending: true } and is updated to
    // { invoiceNumber, serverId, localId, processedAt } on commit.
    let invoiceNumber: string | undefined
    let serverId: string | undefined
    let pending = false
    try {
      const parsed = JSON.parse(marker.details || '{}')
      invoiceNumber = typeof parsed.invoiceNumber === 'string' ? parsed.invoiceNumber : undefined
      serverId = typeof parsed.serverId === 'string' ? parsed.serverId : undefined
      pending = parsed.pending === true
    } catch {
      // Malformed marker details — treat as committed but without references.
      // The frontend will refetch the transaction list to find the invoice.
    }

    // Edge case: the marker exists but still says "pending: true". This means
    // the $transaction inserted the marker (step 0) but the UPDATE (step 9b)
    // never ran — which can only happen if the $transaction was still in
    // progress when this lookup fires (race) OR it rolled back after the
    // marker INSERT (in which case the marker would NOT exist, since the
    // INSERT rolls back too). So a pending marker that survived to here means
    // a concurrent request is mid-transaction. We report found:true but without
    // invoiceNumber — the frontend should wait + re-poll, not retry.
    if (pending && !invoiceNumber) {
      return safeJson({
        found: true,
        pending: true,
        message: 'Transaction is being processed — please wait.',
      })
    }

    return safeJson({
      found: true,
      invoiceNumber,
      serverId,
      processedAt: marker.createdAt,
    })
  } catch (error) {
    console.error('[transactions/lookup] error:', error)
    return safeJsonError('Lookup failed', 500)
  }
}
