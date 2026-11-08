import { describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../access/session-token'
import { HttpError, errorBody, isHttpError } from '../http/errors'
import { createHooks } from '../http/hooks'
import { createLimiter } from '../http/rate-limit'
import { collectHandlers } from '../app'
import type { ModuleMap } from '../modules'
import { modules } from '../modules'
import { registry } from '@mockbench/api-contract'
import type { EndpointDef } from '@mockbench/api-contract'
import { logSink } from './helpers'
import pino from 'pino'

describe('HttpError and the envelope helper', () => {
  it('carries status, code, message and details (always an array)', () => {
    const e = new HttpError(409, 'slug_taken', 'taken')
    expect(isHttpError(e)).toBe(true)
    expect(e.details).toEqual([])
    expect(errorBody('x', 'y')).toEqual({ error: 'x', message: 'y', details: [] })
    expect(isHttpError(new Error('plain'))).toBe(false)
  })
})

describe('hashSessionToken', () => {
  it('is deterministic per secret, differs across secrets and tokens, and is never the token', () => {
    const a = hashSessionToken('tok', 's1')
    expect(a).toBe(hashSessionToken('tok', 's1'))
    expect(a).not.toBe(hashSessionToken('tok', 's2'))
    expect(a).not.toBe(hashSessionToken('tok2', 's1'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toContain('tok')
  })
})

describe('hooks registry (spec: hooks.onVersionDeployed.emit)', () => {
  it('calls every registered listener once, in registration order', async () => {
    const hooks = createHooks()
    const calls: string[] = []
    hooks.onVersionDeployed.on((id) => void calls.push(`a:${id}`))
    hooks.onVersionDeployed.on(async (id) => void calls.push(`b:${id}`))
    hooks.onVersionDeployed.on((id) => void calls.push(`c:${id}`))
    await hooks.onVersionDeployed.emit('p1')
    expect(calls).toEqual(['a:p1', 'b:p1', 'c:p1'])
  })

  it('a throwing listener (sync or async) neither stops the others nor propagates, and is logged once each', async () => {
    const sink = logSink()
    const logger = pino({ level: 'info' }, sink.stream as unknown as pino.DestinationStream)
    const hooks = createHooks(logger)
    const calls: string[] = []
    hooks.onProjectDeleted.on(() => {
      throw new Error('sync boom')
    })
    hooks.onProjectDeleted.on(async () => {
      throw new Error('async boom')
    })
    hooks.onProjectDeleted.on(() => void calls.push('survivor'))
    await expect(hooks.onProjectDeleted.emit('p1')).resolves.toBeUndefined()
    expect(calls).toEqual(['survivor'])
    const errors = sink.lines.filter((l) => l.level === 50)
    expect(errors).toHaveLength(2)
    expect(errors.every((l) => l.hook === 'onProjectDeleted' && l.projectId === 'p1')).toBe(true)
  })

  it('on() returns an unsubscribe function; the two hook points are independent', async () => {
    const hooks = createHooks()
    const fn = vi.fn()
    const off = hooks.onVersionDeployed.on(fn)
    off()
    await hooks.onVersionDeployed.emit('p')
    await hooks.onProjectDeleted.emit('p')
    expect(fn).not.toHaveBeenCalled()
    expect(hooks.onVersionDeployed.size).toBe(0)
  })
})

describe('fixed-window limiter', () => {
  it('allows `limit` requests per key per window, then blocks with a Retry-After, then resets', () => {
    let t = 1_000_000
    const l = createLimiter({ limit: 3, now: () => t })
    expect([1, 2, 3].map(() => l.consume('a').allowed)).toEqual([true, true, true])
    const blocked = l.consume('a')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60)
    expect(l.consume('b').allowed).toBe(true) // other keys unaffected
    t += 60_001
    expect(l.consume('a').allowed).toBe(true)
  })

  it('forgets expired keys so memory stays bounded', () => {
    let t = 0
    const l = createLimiter({ limit: 1, now: () => t })
    for (let i = 0; i < 1000; i++) l.consume(`k${i}`)
    expect(l.size()).toBe(1000)
    t += 61_000
    l.consume('fresh')
    expect(l.size()).toBe(1)
  })
})

describe('module ownership (runtime half of the compile-time guarantee)', () => {
  const endpoints = registry.endpoints as readonly EndpointDef[]
  const noop = async () => ({ status: 200 })

  it('the real modules pass: every handler id is inside its module areas', () => {
    expect(() => collectHandlers(modules as unknown as ModuleMap, endpoints)).not.toThrow()
  })

  it("refuses a handler for another module's endpoint", () => {
    const bad = { projects: { areas: ['projects'], handlers: { 'auth.login': noop } } }
    expect(() => collectHandlers(bad as unknown as ModuleMap, endpoints)).toThrowError(
      /owns areas \[projects\] but binds "auth\.login"/,
    )
  })

  it('refuses an unknown endpoint id and a double binding', () => {
    const unknown = { x: { areas: ['projects'], handlers: { 'projects.nope': noop } } }
    expect(() => collectHandlers(unknown as unknown as ModuleMap, endpoints)).toThrowError(
      /unknown endpoint/,
    )
    const dup = {
      a: { areas: ['projects'], handlers: { 'projects.list': noop } },
      b: { areas: ['projects'], handlers: { 'projects.list': noop } },
    }
    expect(() => collectHandlers(dup as unknown as ModuleMap, endpoints)).toThrowError(
      /more than one module/,
    )
  })

  it('every endpoint area in the registry is owned by exactly one module', () => {
    const areas = new Set(endpoints.map((e) => e.id.split('.')[0]))
    const owned = Object.values(modules).flatMap((m) => [...m.areas])
    expect([...areas].sort()).toEqual([...owned].sort())
    expect(new Set(owned).size).toBe(owned.length)
  })
})
