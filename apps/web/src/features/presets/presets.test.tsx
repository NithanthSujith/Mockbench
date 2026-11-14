import {
  exampleAuthState,
  exampleProject,
  examplePreset,
  type Preset,
} from '@mockbench/api-contract'
import { STARTER_PRESETS, type PresetRule } from '@mockbench/schema-core'
import { createMemoryHistory } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { createAppRouter } from '../../app/router'
import { createQueryClient } from '../../lib/query-client'
import {
  buildSample,
  draftFromRule,
  exportFileName,
  parseImport,
  parseLoose,
  patternPreview,
  ruleFromDraft,
} from './rules'

const WS = exampleAuthState.workspaces[0]!
const project = { ...exampleProject, slug: 'billing-api' }
const seed: Preset = {
  ...examplePreset,
  id: '0190a1b2-c3d4-7e5f-8a6b-0000000000a1',
  projectId: project.id,
  name: 'Indian B2B',
  priority: 10,
  isEnabled: true,
  rules: [{ match: { key: 'role' }, values: ['admin', 'manager', 'viewer'] }],
}

let role: 'owner' | 'editor' | 'viewer' = 'editor'
let presets: Preset[] = []
let creates: Record<string, unknown>[] = []
let updates: Record<string, unknown>[] = []
let failUpdate = false

const server = setupServer(
  http.get('/api/v1/auth/me', () =>
    HttpResponse.json({ ...exampleAuthState, workspaces: [{ ...WS, role }] }),
  ),
  http.get('/api/v1/projects/by-slug/:slug', () => HttpResponse.json(project)),
  http.get('/api/v1/projects/:projectId/routes', () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  http.get('/api/v1/projects', () => HttpResponse.json({ items: [], nextCursor: null })),
  http.get('/api/v1/projects/:projectId/presets', () =>
    HttpResponse.json({ items: presets, nextCursor: null }),
  ),
  http.post('/api/v1/projects/:projectId/presets', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    creates.push(body)
    const created = {
      ...examplePreset,
      id: `0190a1b2-c3d4-7e5f-8a6b-${String(100 + presets.length).padStart(12, '0')}`,
      projectId: project.id,
      isEnabled: true,
      priority: 0,
      ...body,
    } as Preset
    presets = [...presets, created]
    return HttpResponse.json(created, { status: 201 })
  }),
  http.patch('/api/v1/presets/:presetId', async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>
    updates.push(body)
    if (failUpdate) {
      return HttpResponse.json(
        { error: 'forbidden', message: 'Nope.', details: [] },
        { status: 403 },
      )
    }
    presets = presets.map((p) => (p.id === params.presetId ? ({ ...p, ...body } as Preset) : p))
    return HttpResponse.json(presets.find((p) => p.id === params.presetId))
  }),
  http.delete('/api/v1/presets/:presetId', ({ params }) => {
    presets = presets.filter((p) => p.id !== params.presetId)
    return new HttpResponse(null, { status: 204 })
  }),
)

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
  const intercepted = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    intercepted(typeof input === 'string' ? new URL(input, window.location.origin) : input, init),
  )
})
afterEach(() => server.resetHandlers())
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  window.scrollTo = vi.fn()
  role = 'editor'
  presets = [seed]
  creates = []
  updates = []
  failUpdate = false
})

function mount() {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: ['/p/billing-api/presets'] }),
  })
  render(<App queryClient={queryClient} router={router} />)
}

async function openNew() {
  await userEvent.click(await screen.findByRole('button', { name: /New preset/ }))
  await userEvent.type(await screen.findByLabelText('Name'), 'Mine')
  await userEvent.click(screen.getByRole('button', { name: /Add rule/ }))
}

describe('preset helpers', () => {
  it('reads typed values loosely and shows them back', () => {
    expect(parseLoose('INR')).toBe('INR')
    expect(parseLoose('12')).toBe(12)
    expect(parseLoose('"12"')).toBe('12')
    const draft = draftFromRule({ match: { key: 'a' }, value: '12' })
    expect(draft.text).toBe('"12"')
    expect(ruleFromDraft(draft).rule).toEqual({ match: { key: 'a' }, value: '12' })
  })

  it('a rule with no output or no match cannot be built', () => {
    const d = draftFromRule({ match: { key: 'a' }, value: 'x' })
    expect(ruleFromDraft({ ...d, text: '' }).problems?.output).toBeTruthy()
    expect(ruleFromDraft({ ...d, key: '' }).problems?.match).toBeTruthy()
  })

  it('previews a pattern for n=1 and n=12', () => {
    expect(patternPreview('ID-{n:05}', 'id')).toEqual([
      { n: 1, text: 'ID-00001' },
      { n: 12, text: 'ID-00012' },
    ])
  })

  it('samples a path rule through [*] arrays', () => {
    const rows = buildSample([{ match: { path: '$.orders[*].total' }, values: [1, 2] }], 0)
    expect(rows[0]?.text).toBe('1, 2, 1, 2')
  })

  it('lists every import issue with its rule index and creates nothing', () => {
    const result = parseImport(
      JSON.stringify({
        name: 'x',
        priority: 1,
        rules: [
          { match: { key: 'a' }, value: 1 },
          { match: { key: 'b' } },
          { match: {}, value: 1 },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((i) => i.startsWith('rules[1]'))).toBe(true)
      expect(result.issues.some((i) => i.startsWith('rules[2]'))).toBe(true)
      expect(result.issues.some((i) => i.startsWith('rules[0]'))).toBe(false)
    }
  })

  it('names the export file after the preset', () => {
    expect(exportFileName('Indian B2B')).toBe('Indian B2B.preset.json')
    expect(exportFileName('a/b')).toBe('a-b.preset.json')
  })
})

describe('presets list', () => {
  it('shows name, rule count, priority and the switch; toggling patches the server', async () => {
    mount()
    const table = await screen.findByRole('table', { name: 'Presets' })
    const row = within(table).getByRole('row', { name: /Indian B2B/ })
    expect(within(row).getByText('Indian B2B')).toBeInTheDocument()
    expect(within(row).getByText('1')).toBeInTheDocument()
    expect(within(row).getByText('10')).toBeInTheDocument()
    const toggle = within(row).getByRole('switch', { name: 'Enable Indian B2B' })
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    await waitFor(() => expect(updates).toEqual([{ isEnabled: false }]))
    await waitFor(() => expect(screen.getByRole('switch', { name: /Enable/ })).not.toBeChecked())
  })

  it('puts the switch back to the server state when the update fails', async () => {
    failUpdate = true
    mount()
    const toggle = await screen.findByRole('switch', { name: 'Enable Indian B2B' })
    await userEvent.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope.')
    await waitFor(() => expect(screen.getByRole('switch', { name: /Enable/ })).toBeChecked())
  })

  it('explains the specificity order in one sentence', async () => {
    mount()
    expect(await screen.findByText(/path, then key, then key glob, then type/)).toBeInTheDocument()
  })
})

describe('preset editor', () => {
  it('saves key=currency value=INR and the live sample shows INR', async () => {
    mount()
    await openNew()
    await userEvent.type(screen.getByLabelText('Rule 1 key'), 'currency')
    await userEvent.type(screen.getByLabelText('Rule 1 value'), 'INR')
    expect(screen.getAllByTestId('sample-row')[0]).toHaveTextContent('INR, INR, INR, INR')
    await userEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    await waitFor(() => expect(creates).toHaveLength(1))
    expect(creates[0]).toEqual({
      name: 'Mine',
      priority: 0,
      rules: [{ match: { key: 'currency' }, value: 'INR' }],
    })
    expect(await screen.findByText('Mine')).toBeInTheDocument()
  })

  it('values admin, manager, viewer cycle over a four-element array', async () => {
    mount()
    await openNew()
    await userEvent.type(screen.getByLabelText('Rule 1 key'), 'role')
    await userEvent.click(screen.getByRole('tab', { name: 'Values' }))
    await userEvent.type(screen.getByLabelText('Rule 1 values'), 'admin, manager, viewer')
    expect(screen.getAllByTestId('sample-row')[0]).toHaveTextContent(
      'admin, manager, viewer, admin',
    )
  })

  it('a rule with no output cannot be saved and shows the field message', async () => {
    mount()
    await openNew()
    await userEvent.type(screen.getByLabelText('Rule 1 key'), 'currency')
    await userEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    expect(await screen.findByText(/Enter a value/)).toBeInTheDocument()
    expect(creates).toEqual([])
  })

  it('a rule with nothing to match cannot be saved', async () => {
    mount()
    await openNew()
    await userEvent.type(screen.getByLabelText('Rule 1 value'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    expect(await screen.findByText('Match on a key, a path or a type.')).toBeInTheDocument()
    expect(creates).toEqual([])
  })

  it('previews a pattern for n=1 and n=12', async () => {
    mount()
    await openNew()
    await userEvent.type(screen.getByLabelText('Rule 1 key'), 'order_id')
    await userEvent.click(screen.getByRole('tab', { name: 'Pattern' }))
    await userEvent.type(screen.getByLabelText('Rule 1 pattern'), 'ID-{{n:05}')
    const preview = screen.getByTestId('pattern-preview-1')
    expect(preview).toHaveTextContent('ID-00001')
    expect(preview).toHaveTextContent('ID-00012')
  })

  it('edits an existing preset with a patch of its rules', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Indian B2B' }))
    const values = await screen.findByLabelText('Rule 1 values')
    expect(values).toHaveValue('admin, manager, viewer')
    await userEvent.clear(values)
    await userEvent.type(values, 'a, b')
    await userEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0]).toEqual({
      name: 'Indian B2B',
      priority: 10,
      rules: [{ match: { key: 'role' }, values: ['a', 'b'] }],
    })
  })
})

describe('export, import and templates', () => {
  it('exports <name>.preset.json', async () => {
    const clicks: { download: string; href: string }[] = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ download: this.download, href: this.href })
    })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Export Indian B2B' }))
    spy.mockRestore()
    expect(clicks).toHaveLength(1)
    expect(clicks[0]?.download).toBe('Indian B2B.preset.json')
    const body = decodeURIComponent(clicks[0]!.href.split(',').slice(1).join(','))
    expect(JSON.parse(body)).toEqual({
      name: 'Indian B2B',
      priority: 10,
      rules: seed.rules,
    })
  })

  it('a malformed file lists each issue with its rule index and creates nothing', async () => {
    mount()
    const input = await screen.findByLabelText('Import preset file')
    const bad = JSON.stringify({
      name: 'Bad',
      priority: 0,
      rules: [{ match: { key: 'a' }, value: 1 }, { match: { key: 'b' } }],
    })
    await userEvent.upload(input, new File([bad], 'bad.preset.json', { type: 'application/json' }))
    const alert = await screen.findByText(/Nothing was imported/)
    expect(alert).toBeInTheDocument()
    expect(screen.getByText(/rules\[1\]/)).toBeInTheDocument()
    expect(creates).toEqual([])
  })

  it('a valid file creates a preset', async () => {
    mount()
    const input = await screen.findByLabelText('Import preset file')
    const rules: PresetRule[] = [{ match: { key: 'currency' }, value: 'INR' }]
    await userEvent.upload(
      input,
      new File([JSON.stringify({ name: 'Imported', priority: 3, rules })], 'x.preset.json', {
        type: 'application/json',
      }),
    )
    await waitFor(() => expect(creates).toHaveLength(1))
    expect(creates[0]).toEqual({ name: 'Imported', priority: 3, rules, isEnabled: false })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported "Imported" (disabled; switch it on to use it).',
    )
  })

  it('Add from template lists the packs and creates a disabled copy', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /Add from template/ }))
    for (const starter of STARTER_PRESETS) {
      expect(await screen.findByText(starter.name)).toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('button', { name: `Use ${STARTER_PRESETS[0]!.name}` }))
    await waitFor(() => expect(creates).toHaveLength(1))
    expect(creates[0]).toMatchObject({ name: STARTER_PRESETS[0]!.name, isEnabled: false })
  })
})

describe('viewers', () => {
  it('see the list read-only: no save, import, template or delete', async () => {
    role = 'viewer'
    mount()
    expect(await screen.findByRole('table', { name: 'Presets' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable Indian B2B' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /New preset/ })).toBeNull()
    expect(screen.queryByLabelText('Import preset file')).toBeNull()
    expect(screen.queryByRole('button', { name: /Add from template/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'View Indian B2B' }))
    expect(await screen.findByLabelText('Name')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save preset' })).toBeNull()
  })
})
