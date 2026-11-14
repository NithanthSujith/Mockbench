// RUN-13: data-plane rate cap wired through the router (stub cache, no database).
import type { AddressInfo } from 'node:net'
import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../http/logger'
import * as limiterModule from './rate-limit'
import type { RequestLogInput } from './request-log'
import { createDataPlaneRouter } from './router'
import type { VersionCache } from './version-cache'

function setup(rateLimit: number | null | undefined, now?: () => number) {
  const get = vi.fn(() => Promise.resolve({ status: 'unknown' as const }))
  const cache = { get, projectIdFor: () => 'p1' } as unknown as VersionCache
  const records: RequestLogInput[] = []
  const app = express()
  app.set('trust proxy', true)
  app.use(
    '/mock',
    createDataPlaneRouter({
      logger: createLogger({ logLevel: 'silent', nodeEnv: 'test' }),
      cache,
      rateLimit,
      now,
      requestLog: { record: (e: RequestLogInput) => void records.push(e) },
    }),
  )
  return { app, get, records }
}

const from = (app: express.Express, ip: string, method: 'get' | 'options' = 'get') =>
  request(app)[method]('/mock/x/y').set('X-Forwarded-For', ip)

describe('MOCK_RATE_LIMIT', () => {
  it('limits the 6th request per IP, not other IPs, and recovers after the window', async () => {
    let t = 0
    const { app } = setup(5, () => t)
    for (let i = 0; i < 5; i++) expect((await from(app, '1.1.1.1')).status).toBe(404)
    const res = await from(app, '1.1.1.1')
    expect(res.status).toBe(429)
    expect(res.headers['x-mock-error']).toBe('true')
    expect(res.body.error).toBe('rate_limited')
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
    expect((await from(app, '2.2.2.2')).status).toBe(404)
    t += 60_000
    expect((await from(app, '1.1.1.1')).status).toBe(404)
  })

  it('does not count or limit OPTIONS', async () => {
    const { app } = setup(1)
    for (let i = 0; i < 5; i++) expect((await from(app, '1.1.1.1', 'options')).status).toBe(204)
    expect((await from(app, '1.1.1.1')).status).toBe(404)
    expect((await from(app, '1.1.1.1')).status).toBe(429)
    expect((await from(app, '1.1.1.1', 'options')).status).toBe(204)
  })

  it('logs limited requests as rate_limited without touching the cache', async () => {
    const { app, get, records } = setup(1)
    await from(app, '1.1.1.1')
    expect(get).toHaveBeenCalledTimes(1)
    await from(app, '1.1.1.1')
    expect(get).toHaveBeenCalledTimes(1)
    const last = records.at(-1)
    expect(last?.statusCode).toBe(429)
    expect(last?.mockError).toBe('rate_limited')
    expect(last?.projectId).toBe('p1')
  })

  it('unset: no limiter is created and 10,000 requests all succeed', async () => {
    const spy = vi.spyOn(limiterModule, 'createRateLimiter')
    const { app } = setup(undefined)
    const server = app.listen(0)
    try {
      const { port } = server.address() as AddressInfo
      let bad = 0
      for (let batch = 0; batch < 50; batch++) {
        const rs = await Promise.all(
          Array.from({ length: 200 }, () => fetch(`http://127.0.0.1:${port}/mock/x/y`)),
        )
        for (const r of rs) if (r.status !== 404) bad++
      }
      expect(bad).toBe(0)
    } finally {
      server.close()
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  }, 30_000)
})
