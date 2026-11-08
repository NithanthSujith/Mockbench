import { registry, type EndpointDef } from '@mockbench/api-contract'
import { describe, expect, it } from 'vitest'
import { ENDPOINT_TABLE } from './endpoint-table.gen'

/**
 * The browser client does not import the contract registry at runtime (that would ship all of Zod).
 * It uses the generated table in endpoint-table.gen.ts instead; types still come from the registry
 * as type-only imports. This test keeps the table in sync. To regenerate after a contract change:
 *   pnpm --filter @mockbench/web gen:endpoints
 */
type Row = { method: string; path: string; success: number; bodyless: boolean }

function lowestSuccess(responses: Record<number, unknown>): number {
  return Math.min(
    ...Object.keys(responses)
      .map(Number)
      .filter((s) => s >= 200 && s < 300),
  )
}

function expectedTable(): Record<string, Row> {
  const table: Record<string, Row> = {}
  for (const e of registry.endpoints as readonly EndpointDef[]) {
    const success = lowestSuccess(e.responses)
    table[e.id] = {
      method: e.method,
      path: e.path,
      success,
      bodyless: e.responses[success] === null,
    }
  }
  return table
}

function render(table: Record<string, Row>): string {
  const lines = Object.entries(table).map(
    ([id, v]) =>
      `  '${id}': {
    method: '${v.method}',
    path: '${v.path}',
    success: ${v.success},
    bodyless: ${v.bodyless},
  },`,
  )
  return `// GENERATED from packages/api-contract by src/lib/api/endpoint-table.test.ts - do not edit.
// Regenerate with: pnpm --filter @mockbench/web gen:endpoints
export const ENDPOINT_TABLE = {
${lines.join('\n')}
} as const

export type EndpointId = keyof typeof ENDPOINT_TABLE
`
}

describe('endpoint table', () => {
  it('endpoint-table.gen.ts is exactly what the contract registry generates', async () => {
    await expect(render(expectedTable())).toMatchFileSnapshot('./endpoint-table.gen.ts')
  })

  it('matches the registry (ids, methods, paths, success status)', () => {
    expect(ENDPOINT_TABLE).toEqual(expectedTable())
  })

  it('covers every registry endpoint', () => {
    expect(Object.keys(ENDPOINT_TABLE).sort()).toEqual(registry.endpoints.map((e) => e.id).sort())
  })
})
