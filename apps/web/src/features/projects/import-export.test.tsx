// PRJ-06 UI: the Export action on the settings screen and the Import dialog on the project list.
import { exampleAuthState, exampleExport, exampleProject } from '@mockbench/api-contract'
import { createMemoryHistory } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { createAppRouter } from '../../app/router'
import { createQueryClient } from '../../lib/query-client'
import { exportFileName, exportText, formatPath, readProjectFile } from './project-file'

const WS = exampleAuthState.workspaces[0]!
const project = { ...exampleProject, slug: 'billing-api', description: null }

let role: 'owner' | 'editor' | 'viewer' = 'editor'
let imported: unknown[] = []
let importReply: 'ok' | 'invalid' | 'taken' = 'ok'

const server = setupServer(
  http.get('/api/v1/auth/me', () =>
    HttpResponse.json({ ...exampleAuthState, workspaces: [{ ...WS, role }] }),
  ),
  http.get('/api/v1/projects/by-slug/:slug', () => HttpResponse.json(project)),
  http.get('/api/v1/projects/:projectId/routes', () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  http.get('/api/v1/projects/:projectId/export', () => HttpResponse.json(exampleExport)),
  http.get('/api/v1/projects', () => HttpResponse.json({ items: [], nextCursor: null })),
  http.post('/api/v1/projects/import', async ({ request }) => {
    imported.push(await request.json())
    if (importReply === 'taken') {
      return HttpResponse.json(
        { error: 'slug_taken', message: 'taken', details: [] },
        { status: 409 },
      )
    }
    if (importReply === 'invalid') {
      return HttpResponse.json(
        {
          error: 'import_invalid',
          message: 'The file cannot be imported: 2 problems found.',
          details: [
            { path: ['routes', 1, 'path'], code: 'route_conflict', message: 'Collides.' },
            {
              path: ['routes', 0, 'cases', 0, 'headers', 'Host'],
              code: 'reserved_header',
              message: 'Reserved.',
            },
          ],
        },
        { status: 422 },
      )
    }
    return HttpResponse.json({ ...exampleProject, slug: 'shop-copy' }, { status: 201 })
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
  imported = []
  importReply = 'ok'
})

function mount(path: string) {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<App queryClient={queryClient} router={router} />)
  return router
}

const fileOf = (text: string) =>
  new File([text], 'shop.mockbench.json', { type: 'application/json' })

async function openImport() {
  const router = mount(`/w/${WS.slug}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Import project' }))
  return { router, dialog: await screen.findByRole('dialog') }
}

const doc = (over: object = {}) =>
  JSON.stringify({
    formatVersion: 1,
    project: { name: 'Shop', slug: 'shop', description: null, settings: {}, components: {} },
    presets: [],
    routes: [
      {
        method: 'GET',
        path: '/a',
        description: null,
        cases: [
          { name: 'One', isDefault: true },
          { name: 'Two', isDefault: true },
        ],
      },
    ],
    ...over,
  })

describe('project file helpers', () => {
  it('reads counts and default warnings, rejects bad JSON and other versions', () => {
    const r = readProjectFile(doc())
    expect(r.ok && r.file).toMatchObject({
      name: 'Shop',
      slug: 'shop',
      routeCount: 1,
      caseCount: 2,
    })
    expect(r.ok && r.file.warnings[0]).toMatch(/GET \/a marks 2 cases as default/)
    expect(readProjectFile('{nope')).toMatchObject({ ok: false })
    expect(readProjectFile(doc({ formatVersion: 2 }))).toMatchObject({
      ok: false,
      issues: [{ path: ['formatVersion'], code: 'unsupported_format_version' }],
    })
    expect(formatPath(['routes', 1, 'cases', 0, 'name'])).toBe('routes[1].cases[0].name')
    expect(exportFileName('shop')).toBe('shop.mockbench.json')
    expect(exportText({ a: 1 })).toBe('{\n  "a": 1\n}\n')
  })
})

describe('export', () => {
  it('downloads <slug>.mockbench.json from the settings screen', async () => {
    const clicks: { download: string; href: string }[] = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ download: this.download, href: this.href })
    })
    mount('/p/billing-api/settings')
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))
    await waitFor(() => expect(clicks).toHaveLength(1))
    spy.mockRestore()
    expect(clicks[0]?.download).toBe('billing-api.mockbench.json')
    const text = decodeURIComponent(clicks[0]!.href.split(',').slice(1).join(','))
    expect(text).toBe(exportText(exampleExport))
  })

  it('is available to viewers', async () => {
    role = 'viewer'
    mount('/p/billing-api/settings')
    expect(await screen.findByRole('button', { name: 'Export' })).toBeEnabled()
  })
})

describe('import dialog', () => {
  it('is offered to editors only', async () => {
    role = 'viewer'
    mount(`/w/${WS.slug}`)
    await screen.findByText(/No projects yet/)
    expect(screen.queryByRole('button', { name: 'Import project' })).toBeNull()
  })

  it('shows a local problem for a malformed file and a version it cannot read', async () => {
    const { dialog } = await openImport()
    const input = within(dialog).getByLabelText('Project file')
    await userEvent.upload(input, fileOf('{not json'))
    expect(await within(dialog).findByText('The file is not valid JSON.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Import project' })).toBeDisabled()
    await userEvent.upload(input, fileOf(doc({ formatVersion: 2 })))
    expect(await within(dialog).findByText('formatVersion')).toBeInTheDocument()
    expect(imported).toHaveLength(0)
  })

  it('imports a valid file, warns about extra defaults, and navigates to the new project', async () => {
    const { router, dialog } = await openImport()
    await userEvent.upload(within(dialog).getByLabelText('Project file'), fileOf(doc()))
    expect(await within(dialog).findByLabelText('Slug')).toHaveValue('shop')
    expect(within(dialog).getByText(/marks 2 cases as default/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import project' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/p/shop-copy'))
    expect(imported[0]).toMatchObject({ workspaceId: WS.id, slug: 'shop', name: 'Shop' })
  })

  it('lists every server issue with its path', async () => {
    importReply = 'invalid'
    const { dialog } = await openImport()
    await userEvent.upload(within(dialog).getByLabelText('Project file'), fileOf(doc()))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Import project' }))
    const list = await within(dialog).findByRole('list', { name: 'Problems found in the file' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('routes[1].path')
    expect(items[0]).toHaveTextContent('route_conflict')
    expect(items[1]).toHaveTextContent('routes[0].cases[0].headers.Host')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows slug_taken on the slug field', async () => {
    importReply = 'taken'
    const { dialog } = await openImport()
    await userEvent.upload(within(dialog).getByLabelText('Project file'), fileOf(doc()))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Import project' }))
    expect(await within(dialog).findByText(/already used/)).toBeInTheDocument()
  })
})
