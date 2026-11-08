// Route-path grammar and normalisation (API-CONTRACT 1.7). Used by the Builder API, the Runtime
// matcher and the UI, so there is exactly one implementation. Browser-safe, no imports.

export const MAX_ROUTE_PATH_LENGTH = 200
const STATIC_SEGMENT = /^[A-Za-z0-9._~-]+$/
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/

export type PathSegment = { static: string } | { param: string }

export type RoutePathIssueCode =
  | 'path_too_long'
  | 'missing_leading_slash'
  | 'query_or_fragment_not_allowed'
  | 'wildcard_not_allowed'
  | 'trailing_slash'
  | 'empty_segment'
  | 'invalid_static_segment'
  | 'invalid_param_name'
  | 'duplicate_param'

export interface RoutePathIssue {
  code: RoutePathIssueCode
  message: string
}

export type ParsedRoutePath =
  { ok: true; segments: PathSegment[] } | { ok: false; issues: RoutePathIssue[] }

const fail = (code: RoutePathIssueCode, message: string): ParsedRoutePath => ({
  ok: false,
  issues: [{ code, message }],
})

/**
 * Parses a route path against the grammar: starts with `/`, at most 200 chars, no empty segments, no
 * trailing `/` (except the root `/`), each segment either static `[A-Za-z0-9._~-]+` or a `:param`
 * with a name matching `[A-Za-z_][A-Za-z0-9_]{0,39}`, param names unique, no `?`, `#`, `*`.
 * The first failing rule is reported, so each kind of mistake has its own issue code.
 */
export function parseRoutePath(path: string): ParsedRoutePath {
  if (path.length > MAX_ROUTE_PATH_LENGTH) {
    return fail('path_too_long', `A path may be at most ${MAX_ROUTE_PATH_LENGTH} characters.`)
  }
  if (!path.startsWith('/')) return fail('missing_leading_slash', 'A path must start with "/".')
  if (/[?#]/.test(path)) {
    return fail('query_or_fragment_not_allowed', 'A path cannot contain "?" or "#".')
  }
  if (path.includes('*')) return fail('wildcard_not_allowed', 'Wildcards ("*") are not supported.')
  if (path === '/') return { ok: true, segments: [] }
  if (path.endsWith('/')) return fail('trailing_slash', 'A path cannot end with "/".')

  const segments: PathSegment[] = []
  const seen = new Set<string>()
  for (const raw of path.slice(1).split('/')) {
    if (raw === '') return fail('empty_segment', 'A path cannot contain an empty segment ("//").')
    if (raw.startsWith(':')) {
      const name = raw.slice(1)
      if (!PARAM_NAME.test(name)) {
        return fail(
          'invalid_param_name',
          `"${raw}" is not a valid parameter: use :name with letters, digits and "_", starting with a letter or "_", up to 40 characters.`,
        )
      }
      if (seen.has(name)) {
        return fail('duplicate_param', `The parameter ":${name}" appears more than once.`)
      }
      seen.add(name)
      segments.push({ param: name })
    } else {
      if (!STATIC_SEGMENT.test(raw)) {
        return fail(
          'invalid_static_segment',
          `"${raw}" has characters outside A-Z a-z 0-9 . _ ~ - (use :name for a parameter).`,
        )
      }
      segments.push({ static: raw })
    }
  }
  return { ok: true, segments }
}

/**
 * The key two routes are compared by for collisions: static segments lowercased, every `:name`
 * replaced by `{}`. `/Users/:id/orders/:oid` becomes `/users/{}/orders/{}`.
 */
export function normalizePath(path: string): string {
  if (path === '/') return '/'
  return path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '{}' : seg.toLowerCase()))
    .join('/')
}
