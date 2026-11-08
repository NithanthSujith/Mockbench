import type { RequestHandler } from 'msw'

// Optional richer MSW fixtures for this feature in mock mode (pnpm dev:mock) and tests.
// They are tried BEFORE the handlers generated from the contract examples.
export const handlers: RequestHandler[] = []
