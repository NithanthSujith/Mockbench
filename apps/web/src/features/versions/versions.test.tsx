import {
  exampleAuthState,
  exampleDeployment,
  exampleProject,
  exampleVersion,
  exampleVersionSummary,
  type Project,
  type VersionSummary,
} from '@mockbench/api-contract'
import { createMemoryHistory } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { createAppRouter } from '../../app/router'
import { createQueryClient } from '../../lib/query-client'

const WS = exampleAuthState.workspaces[0]!
const BASE = { ...exampleProject, slug: 'billing-api' }
const ver = (seq: number, active = false): VersionSummary => ({
  ...exampleVersionSummary,
  id: `00000000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
  seq,
  label: `v${seq}`,
  isActive: active,
})

let role: 'owner' | 'editor' | 'viewer' = 'editor'
let versions: VersionSummary[] = []
let active: { id: string; label: string } | null = null
let publishError: { status: number; error: string; details?: unknown[] } | null = null
let deployFails = false
let deleteError: string | null = null
let calls: string[] = []

function project(): Project {
  return {
    ...BASE,
    activeVersion: active ? { ...active, deployedAt: exampleDeployment.deployedAt } : null,
  }
}

const server = setupServer(
  http.get('/api/v1/auth/me', () =>
    HttpResponse.json({ ...exampleAuthState, workspaces: [{ ...WS, role }] }),
  ),
  http.get('/api/v1/projects/by-slug/:slug', () => HttpResponse.json(project())),
  http.get('/api/v1/projects/:projectId/routes', () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  http.get('/api/v1/projects/:projectId/versions', () =>
    HttpResponse.json({
      items: [...versions].reverse().map((v) => ({ ...v, isActive: v.id === active?.id })),
      nextCursor: null,
    }),
  ),
  http.get('/api/v1/projects/:projectId/deployments', () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  http.post('/api/v1/projects/:projectId/versions', () => {
    calls.push('publish')
    if (publishError) {
      return HttpResponse.json(
        {
          error: publishError.error,
          message: 'server says no',
          details: publishError.details ?? [],
        },
        { status: publishError.status },
      )
    }
    const v = ver(versions.length + 1)
    versions = [...versions, v]
    return HttpResponse.json({ ...exampleVersion, ...v }, { status: 201 })
  }),
  http.post('/api/v1/projects/:projectId/deploy', async ({ request }) => {
    calls.push('deploy')
    if (deployFails) {
      return HttpResponse.json({ error: 'internal', message: 'x', details: [] }, { status: 500 })
    }
    const { versionId } = (await request.json()) as { versionId: string }
    const v = versions.find((x) => x.id === versionId)!
    active = { id: v.id, label: v.label }
    return HttpResponse.json({ ...exampleDeployment, versionId, versionLabel: v.label })
  }),
  http.delete('/api/v1/versions/:versionId', ({ params }) => {
    calls.push('delete')
    if (deleteError) {
      return HttpResponse.json({ error: deleteError, message: 'x', details: [] }, { status: 409 })
    }
    versions = versions.filter((v) => v.id !== params.versionId)
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
  versions = []
  active = null
  publishError = null
  deployFails = false
  deleteError = null
  calls = []
})

function mount(path = '/p/billing-api/versions') {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<App queryClient={queryClient} router={router} />)
  return router
}

async function openPublish() {
  await userEvent.click(await screen.findByRole('button', { name: 'Publish' }))
  return within(await screen.findByRole('dialog'))
}

describe('versions screen', () => {
  it('shows the empty state when nothing is published', async () => {
    mount()
    expect(
      await screen.findByText(/Nothing published yet\. Publishing freezes every route/),
    ).toBeInTheDocument()
    expect(screen.getByText('not published')).toBeInTheDocument()
  })

  it('marks the live row with a pill and no Deploy button; others can deploy', async () => {
    versions = [ver(1), ver(2)]
    active = { id: versions[1]!.id, label: 'v2' }
    mount()
    const rows = await screen.findAllByRole('row')
    const live = rows.find((r) => within(r).queryByText('v2'))!
    const other = rows.find((r) => within(r).queryByText('v1'))!
    expect(within(live).getByText('LIVE')).toBeInTheDocument()
    expect(within(live).queryByRole('button', { name: 'Deploy' })).toBeNull()
    expect(within(live).queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(within(other).getByRole('button', { name: 'Deploy' })).toBeInTheDocument()
  })

  it('confirms a rollback and updates the topbar pill', async () => {
    versions = [ver(1), ver(2)]
    active = { id: versions[1]!.id, label: 'v2' }
    mount()
    const row = (await screen.findAllByRole('row')).find((r) => within(r).queryByText('v1'))!
    await userEvent.click(within(row).getByRole('button', { name: 'Deploy' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Roll back to v1?')).toBeInTheDocument()
    expect(dialog.getByText('The URL will answer from v1 immediately.')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Roll back' }))
    await waitFor(() =>
      expect(document.querySelector('[data-slot="live-pill"]')).toHaveTextContent('LIVE v1'),
    )
  })

  it('shows version_referenced on delete', async () => {
    versions = [ver(1), ver(2)]
    active = { id: versions[1]!.id, label: 'v2' }
    deleteError = 'version_referenced'
    mount()
    const row = (await screen.findAllByRole('row')).find((r) => within(r).queryByText('v1'))!
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete version' }),
    )
    expect(await screen.findByText('Recent requests still reference this version')).toBeVisible()
  })
})

describe('publish dialog', () => {
  it('publishes then deploys, and the pill shows LIVE without a reload', async () => {
    mount()
    const dialog = await openPublish()
    expect(dialog.getByLabelText('Deploy immediately')).toBeChecked()
    await userEvent.click(dialog.getByRole('button', { name: 'Publish and deploy' }))
    await waitFor(() =>
      expect(document.querySelector('[data-slot="live-pill"]')).toHaveTextContent('LIVE v1'),
    )
    expect(calls).toEqual(['publish', 'deploy'])
  })

  it('only publishes when Deploy immediately is unchecked', async () => {
    mount()
    const dialog = await openPublish()
    await userEvent.click(dialog.getByLabelText('Deploy immediately'))
    await userEvent.click(dialog.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls).toEqual(['publish'])
    expect(screen.getByText('not published')).toBeInTheDocument()
  })

  it('reports a failed deploy and retries without publishing again', async () => {
    deployFails = true
    mount()
    const dialog = await openPublish()
    await userEvent.click(dialog.getByRole('button', { name: 'Publish and deploy' }))
    const alert = await dialog.findByRole('alert')
    expect(alert).toHaveTextContent('Published v1, but it could not be deployed')
    deployFails = false
    await userEvent.click(dialog.getByRole('button', { name: 'Retry deploy' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls).toEqual(['publish', 'deploy', 'deploy'])
  })

  it('lists publish_invalid cases as links to the case', async () => {
    publishError = {
      status: 422,
      error: 'publish_invalid',
      details: [
        {
          routeId: 'r1',
          method: 'GET',
          path: '/users',
          caseId: 'c1',
          caseName: 'ok',
          issues: [{ path: [], code: 'x', message: 'bad body' }],
        },
      ],
    }
    mount()
    const dialog = await openPublish()
    await userEvent.click(dialog.getByRole('button', { name: 'Publish and deploy' }))
    const link = await dialog.findByRole('link', { name: /GET \/users › ok — bad body/ })
    expect(link).toHaveAttribute('href', '/p/billing-api/routes/r1/cases/c1')
  })

  it('explains empty_project and label_taken', async () => {
    publishError = { status: 422, error: 'empty_project' }
    mount()
    const dialog = await openPublish()
    await userEvent.click(dialog.getByRole('button', { name: 'Publish and deploy' }))
    expect(await dialog.findByText('Add at least one route before publishing')).toBeVisible()
    publishError = { status: 409, error: 'label_taken' }
    await userEvent.click(dialog.getByRole('button', { name: 'Publish and deploy' }))
    expect(await dialog.findByText('server says no')).toBeVisible()
  })

  it('hides Publish for viewers', async () => {
    role = 'viewer'
    mount()
    await screen.findByText('not published')
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })
})
