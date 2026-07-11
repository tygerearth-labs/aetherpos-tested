import { NextRequest } from 'next/server'
import { requireWebmaster, webmasterUnauthorized } from '@/lib/api/webmaster-auth'
import { SCENARIOS, SCENARIOS_ALL, type ScenarioResult } from '@/lib/test-scenarios'

// Use merged list
const ALL_SCENARIOS = SCENARIOS_ALL.length > 0 ? SCENARIOS_ALL : SCENARIOS.map(s => ({ ...s, priority: 'ORIGINAL' }))

// GET /api/test-suite — List all scenarios (webmaster only)
export async function GET(request: NextRequest) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  const list = ALL_SCENARIOS.map((s) => ({
    id: s.id,
    priority: s.priority ?? 'ORIGINAL',
    category: s.category,
    name: s.name,
    description: s.description,
  }))
  return Response.json({ scenarios: list })
}

// POST /api/test-suite — Run one or all scenarios
export async function POST(request: NextRequest) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const body = await request.json()
    const scenarioId = body.scenarioId as string | undefined
    const runAll = body.runAll as boolean | undefined
    const priority = body.priority as string | undefined

    if (!scenarioId && !runAll && !priority) {
      return Response.json(
        { error: 'Provide scenarioId, priority, or runAll: true' },
        { status: 400 }
      )
    }

    // Filter by priority if specified
    let targetScenarios = ALL_SCENARIOS
    if (priority) {
      targetScenarios = ALL_SCENARIOS.filter(s => s.priority === priority)
    }

    if (runAll || priority) {
      // Run all (filtered) scenarios sequentially
      const results: ScenarioResult[] = []
      for (const scenario of targetScenarios) {
        try {
          const result = await scenario.run()
          results.push(result)
        } catch (err) {
          results.push({
            id: scenario.id,
            category: scenario.category,
            name: scenario.name,
            description: scenario.description,
            status: 'ERROR',
            steps: [],
            durationMs: 0,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }
      return Response.json({ results })
    }

    // Run single scenario
    const scenario = ALL_SCENARIOS.find((s) => s.id === scenarioId)
    if (!scenario) {
      return Response.json(
        { error: `Scenario "${scenarioId}" not found` },
        { status: 404 }
      )
    }

    const result = await scenario.run()
    return Response.json({ result })
  } catch (error) {
    console.error('Test suite error:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}