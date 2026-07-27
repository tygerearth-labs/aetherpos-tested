/**
 * AETHER BULK ENGINE V1 — file hash for duplicate-upload detection.
 *
 * fileHash = SHA-256(file bytes + ':' + kind + ':' + outletId)
 *
 * If the same file + kind + outlet already has an active (non-completed) job,
 * the engine offers "Resume" instead of creating a duplicate.
 *
 * Also: computeRowsPayloadHash — per-batch payload hash for idempotency conflict
 * detection. Same operationId + same hash = already processed (cached).
 * Same operationId + different hash = conflict (reject).
 */

export async function computeBulkFileHash(
  file: File,
  kind: string,
  outletId: string,
): Promise<string> {
  const fileBytes = new Uint8Array(await file.arrayBuffer())
  const suffix = new TextEncoder().encode(`:${kind}:${outletId}`)
  const combined = new Uint8Array(fileBytes.length + suffix.length)
  combined.set(fileBytes, 0)
  combined.set(suffix, fileBytes.length)

  const subtle = (crypto as Crypto & { subtle: SubtleCrypto }).subtle
  const hashBuffer = await subtle.digest('SHA-256', combined)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Compute a deterministic SHA-256 hash for a batch of parsed rows.
 * Used for idempotency conflict detection (operationId + payloadHash).
 *
 * The server recomputes this and compares:
 *  - match → cached result returned (retry, no duplicate writes)
 *  - mismatch → 409 conflict rejected
 */
export async function computeRowsPayloadHash(
  rows: Array<{ rowIndex: number; data: Record<string, unknown> }>,
): Promise<string> {
  // Deterministic serialization: sort keys, stringify values.
  let serialized = ''
  for (const row of rows) {
    serialized += String(row.rowIndex) + ':'
    const keys = Object.keys(row.data).sort()
    for (const k of keys) {
      serialized += k + '=' + String(row.data[k]) + ';'
    }
    serialized += '|'
  }
  const encoded = new TextEncoder().encode(serialized)
  const subtle = (crypto as Crypto & { subtle: SubtleCrypto }).subtle
  const hashBuffer = await subtle.digest('SHA-256', encoded)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

