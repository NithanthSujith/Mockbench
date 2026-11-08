import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { getLandingPath, getSession, type Session } from '../features/auth/session'

/** Only same-origin absolute paths may be used as a post-login redirect target (no open redirect). */
export function safeRedirectTarget(target: unknown): string | undefined {
  if (typeof target !== 'string') return undefined
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return undefined
  return target
}

/**
 * `beforeLoad` for every protected route: an unauthenticated visitor is redirected to /login (with
 * `?redirect=` so they come back) BEFORE anything renders, so no protected shell ever flashes.
 */
export async function requireSession(args: {
  queryClient: QueryClient
  href: string
}): Promise<{ session: Session }> {
  const session = await getSession(args.queryClient)
  if (!session) {
    throw redirect({ to: '/login', search: { redirect: safeRedirectTarget(args.href) } })
  }
  return { session }
}

/** `beforeLoad` for `/`: signed in -> the landing path; signed out -> /login. */
export async function redirectFromRoot(args: { queryClient: QueryClient }): Promise<never> {
  const session = await getSession(args.queryClient)
  throw redirect({ href: session ? getLandingPath(session) : '/login' })
}
