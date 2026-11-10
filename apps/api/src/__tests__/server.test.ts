import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SESSION_SECRET_PLACEHOLDER } from '../config'
import { withTestDb } from '../db/testing'
import { createShutdown, start } from '../server'
import { createTestSession } from '../testing'
import { logSink } from './helpers'

const quiet = { info: () => {}, warn: () => {} }

function listen(handler: express.Express): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler).listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
    })
  })
}

describe('graceful shutdown', () => {
  const open: Server[] = []
  afterEach(() => {
    for (const s of open.splice(0)) s.closeAllConnections()
  })

  it('stops accepting connections, lets an in-flight request finish, closes the pool, resolves well inside 10 s', async () => {
    const app = express()
    app.get('/slow', (_req, res) => {
      setTimeout(() => res.json({ done: true }), 400)
    })
    const { server, base } = await listen(app)
    open.push(server)
    const closeDb = vi.fn(async () => {})
    const shutdown = createShutdown({ server, closeDb, logger: quiet })

    const inFlight = fetch(`${base}/slow`).then((r) => r.json())
    await new Promise((r) => setTimeout(r, 100)) // request is now being handled
    const t0 = Date.now()
    const stopped = shutdown()

    expect(await inFlight).toEqual({ done: true }) // drained, not cut
    await stopped
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(closeDb).toHaveBeenCalledTimes(1) // after the server closed
    await expect(fetch(`${base}/slow`)).rejects.toThrow() // no longer accepting
  })

  it('an idle keep-alive connection does not hold shutdown open', async () => {
    const app = express()
    app.get('/ping', (_req, res) => void res.json({ ok: true }))
    const { server, base } = await listen(app)
    open.push(server)
    await fetch(`${base}/ping`) // leaves a keep-alive connection behind
    const t0 = Date.now()
    await createShutdown({ server, closeDb: async () => {}, logger: quiet })()
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('a request that never finishes is cut after the drain budget, then the pool is closed', async () => {
    const app = express()
    app.get('/stuck', () => {
      /* never responds */
    })
    const { server, base } = await listen(app)
    open.push(server)
    const closeDb = vi.fn(async () => {})
    const warn = vi.fn()
    const shutdown = createShutdown({
      server,
      closeDb,
      logger: { info: () => {}, warn },
      drainMs: 300,
    })
    const stuck = fetch(`${base}/stuck`).catch((e: unknown) => e)
    await new Promise((r) => setTimeout(r, 100))
    const t0 = Date.now()
    await shutdown()
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(await stuck).toBeInstanceOf(Error)
    expect(warn).toHaveBeenCalled()
    expect(closeDb).toHaveBeenCalledTimes(1)
  })

  it('calling shutdown twice runs it once', async () => {
    const { server } = await listen(express())
    const closeDb = vi.fn(async () => {})
    const shutdown = createShutdown({ server, closeDb, logger: quiet })
    await Promise.all([shutdown(), shutdown()])
    expect(closeDb).toHaveBeenCalledTimes(1)
  })
})

describe('start() against a real port and database', () => {
  async function freePort(): Promise<number> {
    const { server } = await listen(express())
    const port = (server.address() as AddressInfo).port
    await new Promise((r) => server.close(r))
    return port
  }

  it('serves /healthz and /api/v1/readyz on the configured host and port, then shuts down cleanly', async () => {
    const db = await withTestDb()
    const port = await freePort()
    const sink = logSink()
    const started = await start(
      {
        NODE_ENV: 'test',
        DATABASE_URL: db.url,
        SESSION_SECRET: 'a-real-secret',
        HOST: '127.0.0.1',
        API_PORT: String(port),
      },
      { logDestination: sink.stream as never },
    )
    try {
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200)
      const ready = await fetch(`http://127.0.0.1:${port}/api/v1/readyz`)
      expect(await ready.json()).toEqual({ status: 'ok', db: 'up' })
      expect(sink.lines.filter((l) => l.level === 40)).toHaveLength(0) // no warnings with a real secret
    } finally {
      await started.shutdown()
      await db.drop()
    }
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow()
  })

  it('starts the session sweeper (AUTH-01): an expired session is deleted at start-up, a live one is kept', async () => {
    const db = await withTestDb()
    const expired = await createTestSession(db.db, undefined, { expired: true })
    const live = await createTestSession(db.db)
    const port = await freePort()
    const started = await start(
      {
        NODE_ENV: 'test',
        DATABASE_URL: db.url,
        SESSION_SECRET: 'a-real-secret',
        HOST: '127.0.0.1',
        API_PORT: String(port),
      },
      { logDestination: logSink().stream as never },
    )
    try {
      const ids = async () =>
        (await db.pool.query('select id from sessions')).rows.map((r: { id: string }) => r.id)
      const deadline = Date.now() + 5000
      while ((await ids()).includes(expired.sessionId) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50))
      }
      const remaining = await ids()
      expect(remaining).not.toContain(expired.sessionId)
      expect(remaining).toContain(live.sessionId)
    } finally {
      await started.shutdown() // also stops the sweeper timer
      await db.drop()
    }
  })

  it('SESSION_SECRET equal to the .env.example placeholder: starts, and logs exactly ONE warn line naming it', async () => {
    const db = await withTestDb()
    const port = await freePort()
    const sink = logSink()
    const started = await start(
      {
        NODE_ENV: 'test',
        DATABASE_URL: db.url,
        SESSION_SECRET: SESSION_SECRET_PLACEHOLDER,
        HOST: '127.0.0.1',
        API_PORT: String(port),
      },
      { logDestination: sink.stream as never },
    )
    try {
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200)
      const warns = sink.lines.filter((l) => l.level === 40)
      expect(warns).toHaveLength(1)
      expect(String(warns[0]!.msg)).toContain('SESSION_SECRET')
    } finally {
      await started.shutdown()
      await db.drop()
    }
  })

  it('an empty SESSION_SECRET makes start() reject with an error that names the variable', async () => {
    await expect(
      start({ DATABASE_URL: 'postgres://x@127.0.0.1:1/x', SESSION_SECRET: '' }),
    ).rejects.toThrowError(/SESSION_SECRET/)
  })
})
