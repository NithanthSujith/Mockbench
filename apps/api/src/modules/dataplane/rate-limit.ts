// RUN-13: per-client-IP fixed-window limiter for the data plane. Only constructed when
// `MOCK_RATE_LIMIT` is set; when it is unset nothing here is created or called.

/** Upper bound on tracked IPs. Beyond it the oldest windows are evicted (those clients start a fresh window). */
export const MAX_TRACKED_IPS = 50_000
export const WINDOW_MS = 60_000

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }

export interface RateLimiter {
  hit(ip: string): RateDecision
  /** Number of IPs currently tracked. */
  readonly size: number
}

interface Window {
  start: number
  count: number
}

export function createRateLimiter(
  limit: number,
  opts: { now?: () => number; maxTracked?: number } = {},
): RateLimiter {
  const now = opts.now ?? Date.now
  const maxTracked = opts.maxTracked ?? MAX_TRACKED_IPS
  // Insertion order == window start order (a reset deletes then re-inserts), so expired windows
  // are always at the front.
  const windows = new Map<string, Window>()

  function makeRoom(t: number): void {
    for (const [ip, w] of windows) {
      if (t - w.start < WINDOW_MS) break
      windows.delete(ip)
    }
    while (windows.size >= maxTracked) {
      const oldest = windows.keys().next()
      if (oldest.done) break
      windows.delete(oldest.value)
    }
  }

  return {
    get size() {
      return windows.size
    },
    hit(ip) {
      const t = now()
      const w = windows.get(ip)
      if (w && t - w.start < WINDOW_MS) {
        if (w.count >= limit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((w.start + WINDOW_MS - t) / 1000)),
          }
        }
        w.count++
        return { allowed: true }
      }
      if (w) windows.delete(ip)
      else if (windows.size >= maxTracked) makeRoom(t)
      windows.set(ip, { start: t, count: 1 })
      return { allowed: true }
    },
  }
}
