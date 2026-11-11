import { exampleProject } from '@mockbench/api-contract'
import { HttpResponse, http, type RequestHandler } from 'msw'

// Richer MSW fixtures for the project list in mock mode (pnpm dev:mock) and tests. They are tried
// BEFORE the handlers generated from the contract examples.
const PAGE = 2
const projects = ['Billing API', 'Ledger', 'Notifications', 'Search'].map((name, i) => ({
  ...exampleProject,
  id: `00000000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  activeVersion: i === 3 ? null : exampleProject.activeVersion,
}))

export const handlers: RequestHandler[] = [
  // Two pages, so "Load more" is visible in mock mode.
  http.get('/api/v1/projects', ({ request }) => {
    const params = new URL(request.url).searchParams
    // Without a limit (the contract-example test) fall through to the generated example.
    if (!params.has('limit')) return undefined
    const cursor = params.get('cursor')
    const start = cursor ? Number(cursor) : 0
    const items = projects.slice(start, start + PAGE)
    const nextCursor = start + PAGE < projects.length ? String(start + PAGE) : null
    return HttpResponse.json({ items, nextCursor })
  }),
  // A slug named `taken` answers 409, to see the inline error.
  http.post('/api/v1/projects', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (body.slug === 'taken') {
      return HttpResponse.json(
        { error: 'slug_taken', message: 'Slug already used.', details: [] },
        { status: 409 },
      )
    }
    return HttpResponse.json({ ...exampleProject, ...body }, { status: 201 })
  }),
]
