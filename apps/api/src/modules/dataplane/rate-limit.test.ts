// RUN-13: limiter unit tests (fake clock) and the memory bound.
import { describe, expect, it } from 'vitest'
import { MAX_TRACKED_IPS, WINDOW_MS, createRateLimiter } from './rate-limit'

describe('createRateLimiter', () => {
  it('allows up to the limit, then limits with Retry-After, per IP, and resets after the window', () => {
    let t = 1_000_000
    const l = createRateLimiter(5, { now: () => t })
    for (let i = 0; i < 5; i++) expect(l.hit('a').allowed).toBe(true)
    t += 10_000
    expect(l.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 50 })
    expect(l.hit('b').allowed).toBe(true)
    t += WINDOW_MS - 10_000
    expect(l.hit('a').allowed).toBe(true)
  })

  it('stays bounded with 100,000 distinct IPs', () => {
    let t = 0
    const l = createRateLimiter(5, { now: () => t })
    for (let i = 0; i < 100_000; i++) {
      l.hit(`ip-${i}`)
      expect(l.size).toBeLessThanOrEqual(MAX_TRACKED_IPS)
    }
    // Expired windows are pruned once new IPs arrive.
    t += WINDOW_MS + 1
    l.hit('fresh')
    expect(l.size).toBe(1)
  })
})
