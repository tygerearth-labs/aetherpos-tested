import { NextRequest } from 'next/server'
import { SCENARIOS, type ScenarioResult } from '@/lib/test-scenarios'

// GET /api/test-suite — List all scenarios (no execution)
export async function GET() {
  const list = SCENARIOS.map((s) => ({
    id: s.id,
    category: s.category,
    name: s.name,
    description: s.description,
  }))
  return Response.json({ scenarios: list })
}

// POST /api/test-suite — Run one or all scenarios
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const scenarioId = body.scenarioId as string | undefined
    const runAll = body.runAll as boolean | undefined

    if (!scenarioId && !runAll) {
      return Response.json(
        { error: 'Provide scenarioId or runAll: true' },
        { status: 400 }
      )
    }

    if (runAll) {
      // Run all scenarios sequentially
      const results: ScenarioResult[] = []
      for (const scenario of SCENARIOS) {
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
    const scenario = SCENARIOS.find((s) => s.id === scenarioId)
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