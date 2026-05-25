import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { VALID_ACCOUNT_TYPES } from '@/lib/plan-config'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * POST /api/command
 *
 * Secure webhook endpoint for the Command Center to remotely
 * update outlet data, change plan, toggle features, etc.
 *
 * Auth: Bearer token must match COMMAND_SECRET env var.
 *
 * Commands:
 *   SET_PLAN       — Change accountType (free/pro/enterprise)
 *   SET_SETTINGS   — Update outlet settings
 *   SYNC_TRIGGER   — Force client to re-sync (sets a flag)
 *   OUTLET_STATUS  — Enable/disable outlet
 *   BROADCAST      — Send a message/notification to outlet
 */
const VALID_COMMANDS = [
  'SET_PLAN',
  'SET_SETTINGS',
  'SYNC_TRIGGER',
  'OUTLET_STATUS',
  'BROADCAST',
] as const

type CommandType = (typeof VALID_COMMANDS)[number]

interface CommandPayload {
  command: CommandType
  outletId: string          // Target outlet
  data: Record<string, unknown>  // Command-specific data
}

export async function POST(request: NextRequest) {
  try {
    // ---- 1. Auth: Verify COMMAND_SECRET ----
    const authHeader = request.headers.get('authorization')
    const secret = process.env.COMMAND_SECRET

    if (!secret) {
      return safeJsonError('COMMAND_SECRET not configured on server', 500)
    }

    if (!authHeader || authHeader !== `Bearer ${secret}`) {
      return safeJsonError('Unauthorized — invalid or missing command token', 401)
    }

    // ---- 2. Parse & Validate ----
    const body = (await request.json()) as CommandPayload

    if (!body.command || !body.outletId || !body.data) {
      return safeJsonError('Missing required fields: command, outletId, data', 400)
    }

    if (!VALID_COMMANDS.includes(body.command)) {
      return safeJsonError(`Invalid command. Valid: ${VALID_COMMANDS.join(', ')}`, 400)
    }

    // ---- 3. Verify outlet exists ----
    const outlet = await db.outlet.findUnique({
      where: { id: body.outletId },
    })
    if (!outlet) {
      return safeJsonError(`Outlet "${body.outletId}" not found`, 404)
    }

    // ---- 4. Execute Command ----
    const result = await executeCommand(body, outlet.id)

    return safeJson({
      success: true,
      command: body.command,
      outletId: body.outletId,
      result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/command] Error:', error)
    return safeJsonError('Internal server error')
  }
}

// ============================================================
// Command Handlers
// ============================================================

async function executeCommand(
  payload: CommandPayload,
  outletId: string
): Promise<Record<string, unknown>> {
  switch (payload.command) {
    case 'SET_PLAN':
      return await handleSetPlan(outletId, payload.data)
    case 'SET_SETTINGS':
      return await handleSetSettings(outletId, payload.data)
    case 'SYNC_TRIGGER':
      return await handleSyncTrigger(outletId, payload.data)
    case 'OUTLET_STATUS':
      return await handleOutletStatus(outletId, payload.data)
    case 'BROADCAST':
      return handleBroadcast(payload.data)
    default:
      throw new Error(`Unknown command: ${payload.command}`)
  }
}

/**
 * SET_PLAN — Change account type
 * data: { accountType: 'free' | 'pro' | 'enterprise' }
 */
async function handleSetPlan(
  outletId: string,
  data: Record<string, unknown>
) {
  const { accountType } = data

  if (!accountType || typeof accountType !== 'string') {
    throw new Error('data.accountType is required (string)')
  }

  if (!VALID_ACCOUNT_TYPES.includes(accountType as typeof VALID_ACCOUNT_TYPES[number])) {
    throw new Error(
      `Invalid accountType "${accountType}". Valid: ${VALID_ACCOUNT_TYPES.join(', ')}`
    )
  }

  const oldType = (await db.outlet.findUnique({ where: { id: outletId } }))?.accountType || 'free'

  const updated = await db.outlet.update({
    where: { id: outletId },
    data: { accountType: accountType as string },
  })

  console.log(
    `[COMMAND] SET_PLAN: Outlet "${outletId}" ${oldType} → ${accountType}`
  )

  return {
    outletId: updated.id,
    previousPlan: oldType,
    newPlan: updated.accountType,
  }
}

/**
 * SET_SETTINGS — Update outlet settings
 * data: { paymentMethods?, loyaltyEnabled?, loyaltyPointsPerAmount?, ... }
 */
async function handleSetSettings(
  outletId: string,
  data: Record<string, unknown>
) {
  // Only allow known setting fields
  const ALLOWED_KEYS = [
    'paymentMethods',
    'loyaltyEnabled',
    'loyaltyPointsPerAmount',
    'loyaltyPointValue',
    'receiptBusinessName',
    'receiptAddress',
    'receiptPhone',
    'receiptFooter',
    'receiptLogo',
    'themePrimaryColor',
  ] as const

  const updateData: Record<string, unknown> = {}
  for (const key of ALLOWED_KEYS) {
    if (key in data) {
      updateData[key] = data[key]
    }
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error('No valid setting keys provided')
  }

  // Upsert settings
  const setting = await db.outletSetting.upsert({
    where: { outletId },
    update: updateData,
    create: { outletId, ...updateData },
  })

  console.log(
    `[COMMAND] SET_SETTINGS: Outlet "${outletId}" updated ${Object.keys(updateData).length} fields`
  )

  return {
    updatedKeys: Object.keys(updateData),
    settingId: setting.id,
  }
}

/**
 * SYNC_TRIGGER — Set a flag to force client re-sync
 * data: { reason?: string }
 */
async function handleSyncTrigger(
  outletId: string,
  data: Record<string, unknown>
) {
  // Update the outlet's updatedAt to trigger client-side re-sync
  const updated = await db.outlet.update({
    where: { id: outletId },
    data: { updatedAt: new Date() },
  })

  console.log(
    `[COMMAND] SYNC_TRIGGER: Outlet "${outletId}" — reason: ${data.reason || 'manual'}`
  )

  return {
    outletId: updated.id,
    updatedAt: updated.updatedAt,
    reason: data.reason || 'manual',
  }
}

/**
 * OUTLET_STATUS — Enable/disable outlet
 * data: { active: boolean }
 */
async function handleOutletStatus(
  outletId: string,
  data: Record<string, unknown>
) {
  // We use the accountType to indicate status:
  // "free" | "pro" | "enterprise" = active
  // "suspended" = disabled
  const { active } = data

  if (typeof active !== 'boolean') {
    throw new Error('data.active is required (boolean)')
  }

  // Store status in a way that's recoverable
  // If suspending, we prefix with "suspended:" to preserve the original plan
  const outlet = await db.outlet.findUnique({ where: { id: outletId } })
  if (!outlet) throw new Error('Outlet not found')

  let newType: string
  if (active) {
    // Restore from suspended state
    if (outlet.accountType.startsWith('suspended:')) {
      newType = outlet.accountType.replace('suspended:', '')
    } else {
      newType = outlet.accountType
    }
  } else {
    // Suspend — preserve original plan
    if (!outlet.accountType.startsWith('suspended:')) {
      newType = `suspended:${outlet.accountType}`
    } else {
      newType = outlet.accountType
    }
  }

  const updated = await db.outlet.update({
    where: { id: outletId },
    data: { accountType: newType },
  })

  console.log(
    `[COMMAND] OUTLET_STATUS: Outlet "${outletId}" → ${active ? 'ACTIVE' : 'SUSPENDED'}`
  )

  return {
    outletId: updated.id,
    accountType: updated.accountType,
    active,
  }
}

/**
 * BROADCAST — Return a message payload (client polls this)
 * data: { message: string, type?: 'info' | 'warning' | 'critical' }
 */
function handleBroadcast(data: Record<string, unknown>) {
  console.log(`[COMMAND] BROADCAST: ${(data.message as string) || '(no message)'}`)
  return {
    delivered: true,
    message: data.message || '',
    type: data.type || 'info',
  }
}

// ============================================================
// GET — Health check for Command Center
// ============================================================

export async function GET() {
  // K6: Health check — minimal info, no command details exposed
  return safeJson({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
}
