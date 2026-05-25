/**
 * plan-config.ts — Plan Feature Matrix & Constants
 *
 * Defines what features are available for each account type.
 * The Command Center remotely sets accountType on the Outlet model.
 * This file is the single source of truth for feature gating.
 */

export type AccountType = 'free' | 'pro' | 'enterprise'

// ============================================================
// Feature Definitions
// ============================================================

export interface PlanFeatures {
  // Products
  maxProducts: number            // -1 = unlimited
  maxCategories: number          // -1 = unlimited
  productImage: boolean          // Upload product images

  // Team
  maxCrew: number                // -1 = unlimited
  crewPermissions: boolean       // Per-page crew access control

  // Customers
  maxCustomers: number           // -1 = unlimited
  loyaltyProgram: boolean        // Points & rewards

  // Transactions
  maxTransactionsPerMonth: number // -1 = unlimited
  exportExcel: boolean           // Excel export for transactions/products/audit

  // Promos
  maxPromos: number              // -1 = unlimited
  promoTypes: ('PERCENTAGE' | 'NOMINAL')[]

  // Reports
  auditLog: boolean
  stockMovement: boolean
  dashboardAnalytics: boolean

  // AI & Insights
  aiInsights: boolean            // Basic AI insight engine (health score, top insight)
  forecasting: boolean           // Revenue forecasting, stock depletion prediction, trend analysis

  // Advanced
  offlineMode: boolean           // Offline POS (IndexedDB)
  multiOutlet: boolean           // Multiple outlets
  bulkUpload: boolean            // Bulk upload products via Excel
  transactionSummary: boolean    // Transaction summary per outlet
  apiAccess: boolean             // Command Center API access
  prioritySupport: boolean
}

// ============================================================
// Plan Matrix
// ============================================================

export const PLANS: Record<AccountType, PlanFeatures> = {
  free: {
    maxProducts: 50,
    maxCategories: 5,
    productImage: false,

    maxCrew: 2,
    crewPermissions: false,

    maxCustomers: 100,
    loyaltyProgram: true,

    maxTransactionsPerMonth: 500,
    exportExcel: false,

    maxPromos: 2,
    promoTypes: ['PERCENTAGE'],

    auditLog: true,
    stockMovement: true,
    dashboardAnalytics: true,

    aiInsights: false,
    forecasting: false,

    offlineMode: true,
    multiOutlet: false,
    bulkUpload: false,
    transactionSummary: false,
    apiAccess: false,
    prioritySupport: false,
  },

  pro: {
    maxProducts: -1,
    maxCategories: -1,
    productImage: true,

    maxCrew: -1,
    crewPermissions: true,

    maxCustomers: -1,
    loyaltyProgram: true,

    maxTransactionsPerMonth: -1,
    exportExcel: true,

    maxPromos: -1,
    promoTypes: ['PERCENTAGE', 'NOMINAL'],

    auditLog: true,
    stockMovement: true,
    dashboardAnalytics: true,

    aiInsights: true,
    forecasting: true,

    offlineMode: true,
    multiOutlet: false,
    bulkUpload: true,
    transactionSummary: true,
    apiAccess: true,
    prioritySupport: true,
  },

  enterprise: {
    maxProducts: -1,
    maxCategories: -1,
    productImage: true,

    maxCrew: -1,
    crewPermissions: true,

    maxCustomers: -1,
    loyaltyProgram: true,

    maxTransactionsPerMonth: -1,
    exportExcel: true,

    maxPromos: -1,
    promoTypes: ['PERCENTAGE', 'NOMINAL'],

    auditLog: true,
    stockMovement: true,
    dashboardAnalytics: true,

    aiInsights: true,
    forecasting: true,

    offlineMode: true,
    multiOutlet: true,
    bulkUpload: true,
    transactionSummary: true,
    apiAccess: true,
    prioritySupport: true,
  },
}

// ============================================================
// Helpers
// ============================================================

/** Get the feature matrix for a given account type */
export function getPlanFeatures(accountType: string): PlanFeatures {
  const plan = PLANS[accountType as AccountType]
  if (!plan) {
    console.warn(`[plan-config] Unknown accountType "${accountType}", falling back to "free"`)
    return PLANS.free
  }
  return plan
}

/** Check if a numeric limit is effectively unlimited */
export function isUnlimited(value: number): boolean {
  return value === -1
}

/** Format a limit for display (e.g. "Unlimited", "50") */
export function formatLimit(value: number): string {
  return value === -1 ? 'Unlimited' : String(value)
}

/** Get the display label for an account type */
export function getPlanLabel(accountType: string): string {
  switch (accountType) {
    case 'free':       return 'Free'
    case 'pro':        return 'Pro'
    case 'enterprise': return 'Enterprise'
    default:           return 'Free'
  }
}

/** Get the badge color class for an account type */
export function getPlanBadgeClass(accountType: string): string {
  switch (accountType) {
    case 'pro':        return 'bg-violet-500/10 border-violet-500/20 text-violet-400'
    case 'enterprise': return 'bg-amber-500/10 border-amber-500/20 text-amber-400'
    default:           return 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400'
  }
}

/** All valid account types (for validation) */
export const VALID_ACCOUNT_TYPES: AccountType[] = ['free', 'pro', 'enterprise']

// ============================================================
// Runtime plan check helper (for API routes)
// ============================================================

/**
 * Fetch the outlet's resolved plan features from the database.
 * Handles "suspended:xxx" prefix transparently.
 * Returns null if outlet not found.
 */
export async function getOutletPlan(
  outletId: string,
  prismaDb: { outlet: { findUnique: (args: { where: { id: string }; select: { accountType: true } }) => Promise<{ accountType: string } | null> } }
): Promise<{ plan: AccountType; features: PlanFeatures; isSuspended: boolean } | null> {
  const outlet = await prismaDb.outlet.findUnique({
    where: { id: outletId },
    select: { accountType: true },
  })
  if (!outlet) return null

  const isSuspended = outlet.accountType.startsWith('suspended:')
  const rawPlan = isSuspended
    ? outlet.accountType.replace('suspended:', '')
    : outlet.accountType

  const features = getPlanFeatures(rawPlan)
  return { plan: rawPlan as AccountType, features, isSuspended }
}
