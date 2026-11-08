// The BUILT artifact (esbuild bundle) must work with plain `node` plus environment variables,
// from a folder where node_modules is resolvable: this is exactly what the Docker image runs.
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SESSION_SECRET_PLACEHOLDER } from '../config'
import { withTestDb } from '../db/testing'
// @ts-expect-error plain .mjs build script without type declarations
import { buildApi } from '../../build.mjs'

const apiRoot = fileURLToPath(new URL('../..', import.meta.url))
// Inside apps/api so `express`, `pg`, `pino`... resolve from apps/api/node_modules, as in the image.
const outdir = resolve(apiRoot, `.tmp-build-${randomBytes(4).toString('hex')}`)

const children: ChildProcessWithoutNullStreams[] = []

function freePort(): Promise<number> {
  return new Promise((resolvePort) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolvePort(port))
    })
  })
}

interface Run {
  child: ChildProcessWithoutNullStreams
  stdout: () => string
  stderr: () => string
  exited: Promise<number | null>
  waitFor: (text: string, ms?: number) => Promise<void>
}

function run(file: string, env: Record<string, string>): Run {
  const child = spawn(process.execPath, [resolve(outdir, file)], {
    cwd: apiRoot,
    env: { PATH: process.env.PATH ?? '', ...env },
  })
  children.push(child)
  let out = ''
  let err = ''
  child.stdout.on('data', (d) => (out += String(d)))
  child.stderr.on('data', (d) => (err += String(d)))
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)))
  const waitFor = (text: string, ms = 15000) =>
    new Promise<void>((resolveWait, reject) => {
      const t0 = Date.now()
      const tick = setInterval(() => {
        if (out.includes(text)) {
          clearInterval(tick)
          resolveWait()
        } else if (Date.now() - t0 > ms) {
          clearInterval(tick)
          reject(new Error(`timed out waiting for "${text}". stdout:\n${out}\nstderr:\n${err}`))
        }
      }, 50)
    })
  return { child, stdout: () => out, stderr: () => err, exited, waitFor }
}

beforeAll(async () => {
  await buildApi({ outdir })
}, 60_000)

afterAll(() => {
  for (const c of children) if (c.exitCode === null) c.kill('SIGKILL')
  rmSync(outdir, { recursive: true, force: true })
})

describe('built artifact (node dist/server.js)', () => {
  it('emits server.js, migrate.js and the migrations folder, with workspace packages inlined', () => {
    expect(existsSync(resolve(outdir, 'server.js'))).toBe(true)
    expect(existsSync(resolve(outdir, 'migrate.js'))).toBe(true)
    expect(existsSync(resolve(outdir, 'migrations/meta/_journal.json'))).toBe(true)
    const bundle = readFileSync(resolve(outdir, 'server.js'), 'utf8')
    // @mockbench/* are inlined (no runtime import of TypeScript source); other deps stay external.
    expect(bundle).not.toMatch(/from ["']@mockbench\//)
    expect(bundle).toMatch(/from ["']express["']/)
    expect(bundle).toMatch(/from ["']pg["']/)
  })

  it('starts with only `node` + env and serves /healthz, /api/v1/readyz, /api/v1/instance and the 501 data plane', async () => {
    const db = await withTestDb()
    const port = await freePort()
    const r = run('server.js', {
      DATABASE_URL: db.url,
      SESSION_SECRET: 'a-real-secret',
      HOST: '127.0.0.1',
      API_PORT: String(port),
      NODE_ENV: 'production',
    })
    try {
      await r.waitFor('api listening')
      const base = `http://127.0.0.1:${port}`
      expect((await fetch(`${base}/healthz`)).status).toBe(200)
      expect(await (await fetch(`${base}/api/v1/readyz`)).json()).toEqual({
        status: 'ok',
        db: 'up',
      })
      const instance = (await (await fetch(`${base}/api/v1/instance`)).json()) as {
        setupRequired: boolean
      }
      expect(instance.setupRequired).toBe(true)
      const mock = await fetch(`${base}/mock/demo/x`)
      expect(mock.status).toBe(501)
      expect(mock.headers.get('x-mock-error')).toBe('true')
      // production: responses are NOT contract-checked, and the log is JSON lines on stdout
      expect(
        r
          .stdout()
          .split('\n')
          .filter(Boolean)
          .every((l) => l.startsWith('{')),
      ).toBe(true)
    } finally {
      r.child.kill('SIGKILL')
      await r.exited
      await db.drop()
    }
  })

  it('placeholder SESSION_SECRET: starts and logs exactly one warn line', async () => {
    const db = await withTestDb()
    const port = await freePort()
    const r = run('server.js', {
      DATABASE_URL: db.url,
      SESSION_SECRET: SESSION_SECRET_PLACEHOLDER,
      HOST: '127.0.0.1',
      API_PORT: String(port),
    })
    try {
      await r.waitFor('api listening')
      const warns = r
        .stdout()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { level: number; msg: string })
        .filter((l) => l.level === 40)
      expect(warns).toHaveLength(1)
      expect(warns[0]!.msg).toContain('SESSION_SECRET')
    } finally {
      r.child.kill('SIGKILL')
      await r.exited
      await db.drop()
    }
  })

  it('an empty SESSION_SECRET exits non-zero, names the variable, and never listens', async () => {
    const r = run('server.js', {
      DATABASE_URL: 'postgres://mock:mock@127.0.0.1:55432/postgres',
      SESSION_SECRET: '',
    })
    const code = await r.exited
    expect(code).not.toBe(0)
    expect(code).not.toBeNull()
    expect(r.stderr()).toContain('SESSION_SECRET')
    expect(r.stdout()).not.toContain('api listening')
  })

  it.skipIf(process.platform === 'win32')(
    'SIGTERM stops accepting connections, exits 0 within 10 s',
    async () => {
      const db = await withTestDb()
      const port = await freePort()
      const r = run('server.js', {
        DATABASE_URL: db.url,
        SESSION_SECRET: 'a-real-secret',
        HOST: '127.0.0.1',
        API_PORT: String(port),
      })
      try {
        await r.waitFor('api listening')
        await fetch(`http://127.0.0.1:${port}/healthz`) // leaves a keep-alive connection open
        const t0 = Date.now()
        r.child.kill('SIGTERM')
        expect(await r.exited).toBe(0)
        expect(Date.now() - t0).toBeLessThan(10_000)
        await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow()
        expect(r.stdout()).toContain('shutting down')
      } finally {
        if (r.child.exitCode === null) r.child.kill('SIGKILL')
        await db.drop()
      }
    },
  )
})

describe('built artifact (node dist/migrate.js)', () => {
  it('applies the shipped migrations to an empty database and exits 0', async () => {
    const db = await withTestDb({ migrate: false })
    try {
      const r = spawnSync(process.execPath, [resolve(outdir, 'migrate.js')], {
        cwd: apiRoot,
        env: { PATH: process.env.PATH ?? '', DATABASE_URL: db.url },
        encoding: 'utf8',
      })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toMatch(/migrate: applied \d+ migration/)
      const { rows } = await db.pool.query(`select to_regclass('public.users') as t`)
      expect(rows[0].t).toBe('users')
    } finally {
      await db.drop()
    }
  }, 60_000)
})
