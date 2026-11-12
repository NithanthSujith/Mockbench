import {
  exampleCase,
  exampleProject,
  examplePreset,
  exampleRoute,
  type MockSchemaEnvelope,
  type ResponseCase,
} from '@mockbench/api-contract'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import workedExample from '../../../../../packages/schema-core/fixtures/worked-example.schema.json'
import workedGolden from '../../../../../packages/schema-core/fixtures/worked-example.deterministic-local.golden.txt?raw'
import { computePreview } from './compute'
import { ResponsePreview, PREVIEW_DEBOUNCE_MS } from './ResponsePreview'

const GOLDEN_PROJECT_ID = '11111111-1111-7111-8111-111111111111'
const worked = workedExample as unknown as MockSchemaEnvelope
const leaf = (type: string) => ({ type })
const envelope = (...fields: [string, object][]): MockSchemaEnvelope =>
  ({
    version: 1,
    components: {},
    root: { type: 'object', fields: fields.map(([key, node]) => ({ key, node })) },
  }) as MockSchemaEnvelope

let settings = { ...exampleProject.settings }
let presets = [{ ...examplePreset, isEnabled: true }]
const route = { ...exampleRoute, projectId: GOLDEN_PROJECT_ID }
const mkCase = (schema: MockSchemaEnvelope, patch: Partial<ResponseCase> = {}): ResponseCase => ({
  ...exampleCase,
  schema,
  statusCode: 200,
  delayMs: null,
  ...patch,
})

const server = setupServer(
  http.get('/api/v1/projects/:projectId', () =>
    HttpResponse.json({ ...exampleProject, id: GOLDEN_PROJECT_ID, settings }),
  ),
  http.get('/api/v1/projects/:projectId/presets', () =>
    HttpResponse.json({ items: presets, nextCursor: null }),
  ),
)
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
  const intercepted = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    intercepted(typeof input === 'string' ? new URL(input, window.location.origin) : input, init),
  )
})
afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  settings = { ...exampleProject.settings, indexing: 'local', mode: 'deterministic' }
  presets = []
})

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function mount(c: ResponseCase, client = newClient()) {
  const utils = render(<ResponsePreview case={c} route={route} />, { wrapper: wrap(client) })
  return {
    ...utils,
    client,
    set: (next: ResponseCase) => utils.rerender(<ResponsePreview case={next} route={route} />),
  }
}
const previewText = () => screen.getByLabelText('Response preview').textContent

describe('computePreview', () => {
  it('equals the schema-core golden for the worked example', () => {
    const r = computePreview({
      schema: worked,
      projectId: GOLDEN_PROJECT_ID,
      settings: { indexing: 'local', mode: 'deterministic' },
      components: {},
      presets: [],
    })
    expect(r.kind === 'ok' && `${r.json}\n`).toBe(workedGolden)
  })

  it('marks a preset-covered leaf as preset and others as generated', () => {
    const r = computePreview({
      schema: envelope(['currency', leaf('string')], ['name', leaf('string')]),
      projectId: GOLDEN_PROJECT_ID,
      settings: { indexing: 'local', mode: 'deterministic' },
      components: {},
      presets: [{ priority: 0, rules: [{ match: { key: 'currency' }, value: 'INR' }] }],
    })
    if (r.kind !== 'ok') throw new Error('expected ok')
    expect(r.provenance['/currency']).toBe('preset')
    expect(r.provenance['/name']).toBe('generated')
  })

  it('reports validator issues and the leaf limit', () => {
    const base = { projectId: GOLDEN_PROJECT_ID, components: {}, presets: [] }
    const settings = { indexing: 'local', mode: 'deterministic' } as const
    const bad = computePreview({ ...base, settings, schema: { version: 1, root: { type: 'zzz' } } })
    expect(bad.kind).toBe('invalid')
    const huge = {
      version: 1,
      components: {},
      root: {
        type: 'array',
        count: 1000,
        items: { type: 'array', count: 1000, items: leaf('string') },
      },
    }
    expect(computePreview({ ...base, settings, schema: huge }).kind).toBe('too-large')
  })
})

describe('ResponsePreview', () => {
  it('renders the golden text and the diagnostic headers and legend', async () => {
    mount(mkCase(worked))
    expect(await screen.findByLabelText('Response preview')).toBeInTheDocument()
    expect(screen.getByText('X-Mock-Route')).toBeInTheDocument()
    expect(screen.getByText(/generated from the key/)).toBeInTheDocument()
    expect(screen.getByText(/pinned or from a preset/)).toBeInTheDocument()
  })

  it('regenerates once, 150 ms after the last change, with no network traffic', async () => {
    const view = mount(mkCase(envelope(['name', leaf('string')])))
    await screen.findByLabelText('Response preview')
    const spy = vi.fn(globalThis.fetch)
    vi.stubGlobal('fetch', spy)
    vi.useFakeTimers()

    const a = mkCase(envelope(['alpha', leaf('string')]))
    const b = mkCase(envelope(['beta', leaf('string')]))
    act(() => view.set(a))
    act(() => {
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 10)
    })
    expect(previewText()).toContain('name-1')
    act(() => view.set(b))
    act(() => {
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 10)
    })
    expect(previewText()).toContain('name-1')
    act(() => {
      vi.advanceTimersByTime(10)
    })
    expect(previewText()).toContain('"beta": "beta-1"')
    expect(previewText()).not.toContain('alpha')
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows a pinned preset leaf with the fixed style and a generated leaf underlined', async () => {
    presets = [
      {
        ...examplePreset,
        isEnabled: true,
        rules: [{ match: { key: 'currency' }, value: 'INR' }],
      },
      {
        ...examplePreset,
        id: '00000000-0000-7000-8000-000000000999',
        isEnabled: false,
        rules: [{ match: { key: 'name' }, value: 'DISABLED' }],
      },
    ] as typeof presets
    mount(mkCase(envelope(['currency', leaf('string')], ['name', leaf('string')])))
    await screen.findByLabelText('Response preview')
    expect(screen.getByLabelText('Response preview').textContent).not.toContain('DISABLED')
    const pinned = document.querySelector('[data-provenance="preset"]')
    expect(pinned?.textContent).toBe('"INR"')
    expect(document.querySelector('[data-provenance="generated"]')?.textContent).toBe('"name-1"')
  })

  it('explains determinism in deterministic mode', async () => {
    mount(mkCase(worked))
    await screen.findByLabelText('Response preview')
    expect(
      screen.getByText(/Values come from the key and position/).parentElement?.textContent,
    ).toContain(
      'Values come from the key and position, so role becomes role-1 — change this in project settings.',
    )
  })

  it('shows the warning chip instead in random mode', async () => {
    settings = { ...settings, mode: 'random' }
    mount(mkCase(worked))
    await screen.findByLabelText('Response preview')
    expect(screen.getByText('Fresh on every request — not baked')).toBeInTheDocument()
    expect(screen.queryByText(/Values come from the key/)).toBeNull()
  })

  it('shows the no-body line for a 204', async () => {
    mount(mkCase(worked, { statusCode: 204 }))
    expect(await screen.findByText('— 204 sends no response body —')).toBeInTheDocument()
    expect(screen.queryByLabelText('Response preview')).toBeNull()
  })

  it('shows validator issues instead of JSON for an invalid schema', async () => {
    mount(mkCase({ version: 1, components: {}, root: { type: 'zzz' } } as never))
    expect(await screen.findByText(/not valid/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Response preview')).toBeNull()
  })

  it('says a schema is too large to preview, without generating it', async () => {
    const huge = {
      version: 1,
      components: {},
      root: {
        type: 'array',
        count: 1000,
        items: { type: 'array', count: 1000, items: leaf('string') },
      },
    } as unknown as MockSchemaEnvelope
    mount(mkCase(huge))
    expect(await screen.findByText(/Too large to preview: would generate/)).toHaveTextContent(
      '(limit 50,000)',
    )
  })

  it('refetches presets when it mounts again after they changed', async () => {
    const schema = envelope(['currency', leaf('string')])
    const client = newClient()
    const first = mount(mkCase(schema), client)
    await screen.findByLabelText('Response preview')
    expect(previewText()).toContain('currency-1')
    first.unmount()
    presets = [
      { ...examplePreset, isEnabled: true, rules: [{ match: { key: 'currency' }, value: 'INR' }] },
    ] as typeof presets
    mount(mkCase(schema), client)
    await vi.waitFor(() => expect(previewText()).toContain('"INR"'))
  })

  it('stays fast for a 2,000-node schema', () => {
    const fields = Array.from({ length: 1999 }, (_, i) => ({ key: `f${i}`, node: leaf('string') }))
    const big = { version: 1, components: {}, root: { type: 'object', fields } }
    const start = performance.now()
    const r = computePreview({
      schema: big,
      projectId: GOLDEN_PROJECT_ID,
      settings: { indexing: 'local', mode: 'deterministic' },
      components: {},
      presets: [],
    })
    expect(r.kind).toBe('ok')
    expect(performance.now() - start).toBeLessThan(100)
  })
})
