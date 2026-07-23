/**
 * MIG-BATCH-V3: fileHash = SHA-256(file bytes + ':' + mode + ':' + outletId).
 *
 * Used for duplicate-upload detection: if the same file + mode + outlet already
 * has an active (non-completed) job, the wizard offers "Lanjutkan" instead of
 * creating a second active job.
 */

export async function computeFileHash(file: File, mode: string, outletId: string): Promise<string> {
  const fileBytes = new Uint8Array(await file.arrayBuffer())
  const suffix = new TextEncoder().encode(`:${mode}:${outletId}`)
  const combined = new Uint8Array(fileBytes.length + suffix.length)
  combined.set(fileBytes, 0)
  combined.set(suffix, fileBytes.length)

  const subtle = (crypto as Crypto & { subtle: SubtleCrypto }).subtle
  const hashBuffer = await subtle.digest('SHA-256', combined)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}
