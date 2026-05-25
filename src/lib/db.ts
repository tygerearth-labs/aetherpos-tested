/**
 * db.ts — Prisma Client (PostgreSQL via Neon)
 *
 * SINGLE import point for all API routes.
 * Works with Neon (production/Vercel) and local PostgreSQL.
 *
 * Offline mode (POS) uses IndexedDB (Dexie) client-side — independent of this.
 */

import { PrismaClient } from '@prisma/client'

// ---------- Singleton ----------
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : [],
  })
}

export const db: PrismaClient =
  globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}
