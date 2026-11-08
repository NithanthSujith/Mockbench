import { describe, expect, it } from 'vitest'
import { ApiError } from './api/errors'
import { STALE, createQueryClient } from './query-client'
import { qk } from './query-keys'

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => JSON.stringify(key[i]) === JSON.stringify(part))

describe('query keys', () => {
  it('every key about a project lives under qk.project(id).all, so one invalidation drops them all', () => {
    const p = qk.project('p1')
    for (const key of [
      p.detail,
      p.routes,
      p.presets,
      p.versions,
      p.deployments,
      p.requests({ status: '4xx' }),
      qk.route('p1', 'r1').detail,
      qk.route('p1', 'r1').cases,
      qk.route('p1', 'r1').case('c1'),
      qk.version('p1', 'v1'),
      qk.versionDiff('p1', 'v1', 'v2'),
    ]) {
      expect(startsWith(key, p.all)).toBe(true)
    }
  })

  it('keys for different projects never share a prefix', () => {
    expect(startsWith(qk.project('p2').routes, qk.project('p1').all)).toBe(false)
  })

  it('request-log filters are part of the key (different filters, different cache entries)', () => {
    expect(qk.project('p1').requests({ status: '4xx' })).not.toEqual(
      qk.project('p1').requests({ status: '5xx' }),
    )
  })

  it('has stable top-level keys', () => {
    expect(qk.session()).toEqual(['session'])
    expect(qk.projects('w1')).toEqual(['workspace', 'w1', 'projects'])
    expect(qk.projectBySlug('billing-api')).toEqual(['project-by-slug', 'billing-api'])
  })
})

describe('query client defaults', () => {
  it('keeps the route tree fresh much longer than ordinary data', () => {
    expect(STALE.routeTree).toBeGreaterThan(STALE.default)
    expect(createQueryClient().getDefaultOptions().queries?.staleTime).toBe(STALE.default)
  })

  it('does not retry client errors or a not-yet-implemented endpoint, but retries server errors twice', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (
      count: number,
      error: unknown,
    ) => boolean
    expect(retry(0, new ApiError(404, 'not_found', 'x'))).toBe(false)
    expect(retry(0, new ApiError(401, 'unauthenticated', 'x'))).toBe(false)
    expect(retry(0, new ApiError(501, 'not_implemented', 'x'))).toBe(false)
    expect(retry(0, new ApiError(500, 'internal_error', 'x'))).toBe(true)
    expect(retry(1, new ApiError(0, 'network_error', 'x'))).toBe(true)
    expect(retry(2, new ApiError(500, 'internal_error', 'x'))).toBe(false)
  })
})
