/**
 * db.ts — Prisma Client
 *
 * SINGLE import point for all API routes.
 *
 * Production (Vercel + Neon): Uses @prisma/adapter-neon for serverless-optimized
 * connections via Neon's pooled connection string.
 *
 * Development (local): Uses standard PrismaClient with SQLite.
 *
 * Offline mode (POS) uses IndexedDB (Dexie) client-side — independent of this.
 */

import { PrismaClient } from '@prisma/client'

// ---------- Singleton ----------
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient(): PrismaClient {
  const datasourceUrl = process.env.DATABASE_URL || ''

  // Detect if running against Neon PostgreSQL in production (Vercel)
  const isNeonProduction =
    process.env.NODE_ENV === 'production' &&
    (datasourceUrl.startsWith('postgresql://') || datasourceUrl.startsWith('postgres://'))

  if (isNeonProduction) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Pool } = require('@neondatabase/serverless')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaNeon } = require('@prisma/adapter-neon')

      const pool = new Pool({ connectionString: datasourceUrl })
      const adapter = new PrismaNeon(pool)

      return new PrismaClient({
        adapter,
        log: [],
      })
    } catch {
      // Fallback to standard client if adapter not available
      console.warn('[db] Neon adapter not available, using standard PrismaClient')
    }
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : [],
  })
}

export const db: PrismaClient =
  globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}
