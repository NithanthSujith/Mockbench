import { exampleRoute } from '@mockbench/api-contract'
import { HttpResponse, http, type RequestHandler } from 'msw'

// Richer MSW fixtures for the route rail in mock mode (pnpm dev:mock) and tests. They are tried
// BEFORE the handlers generated from the contract examples; returning undefined falls through.
export const handlers: RequestHandler[] = [
  // A project named `missing` is one the caller cannot see: 404, no leak of existence.
  http.get('/api/v1/projects/by-slug/:slug', ({ params }) =>
    params.slug === 'missing'
      ? HttpResponse.json(
          { error: 'not_found', message: 'Project not found.', details: [] },
          { status: 404 },
        )
      : undefined,
  ),
  // Creating `GET /orders` collides with the example route (the contract example request must still succeed).
  http.post('/api/v1/projects/:projectId/routes', async ({ request }) => {
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as { method?: string; path?: string }
    if (body.method === 'GET' && body.path === '/orders') {
      return HttpResponse.json(
        {
          error: 'route_conflict',
          message: 'A route with this method and path already exists.',
          details: [{ routeId: exampleRoute.id }],
        },
        { status: 409 },
      )
    }
    return undefined
  }),
]
