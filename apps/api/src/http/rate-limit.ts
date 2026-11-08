// Small in-memory fixed-window limiter (no dependency). One instance per policy:
// control plane (per session / per IP) and login (per IP). The data-plane cap is RUN-13.

export interface LimiterOptions {
  /** Requests allowed per window. */
  limit: number
  /** Window length. Default 60 s. */
  windowMs?: number
  /** Clock, injectable for tests. */
  now?: () => number
}

export interface LimitResult {
  allowed: boolean
  remaining: number
  /** Whole seconds until the window resets (>= 1 when blocked). */
  retryAfterSec: number
}

export interface Limiter {
  consume(key: string): LimitResult
  /** Number of tracked keys (for memory-bound tests). */
  size(): number
}

export function createLimiter(opts: LimiterOptions): Limiter {
  const windowMs = opts.windowMs ?? 60_000
  const now = opts.now ?? Date.now
  const windows = new Map<string, { count: number; resetAt: number }>()
  let lastSweep = now()

  function sweep(t: number) {
    lastSweep = t
    for (const [key, w] of windows) if (w.resetAt <= t) windows.delete(key)
  }

  return {
    consume(key) {
      const t = now()
      if (t - lastSweep >= windowMs) sweep(t)
      let w = windows.get(key)
      if (!w || w.resetAt <= t) {
        w = { count: 0, resetAt: t + windowMs }
        windows.set(key, w)
      }
      if (w.count >= opts.limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSec: Math.max(1, Math.ceil((w.resetAt - t) / 1000)),
        }
      }
      w.count++
      return {
        allowed: true,
        remaining: opts.limit - w.count,
        retryAfterSec: Math.max(1, Math.ceil((w.resetAt - t) / 1000)),
      }
    },
    size: () => windows.size,
  }
}
