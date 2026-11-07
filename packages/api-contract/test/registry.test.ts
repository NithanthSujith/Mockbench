import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  Id,
  RegistryError,
  defineEndpoint,
  defineRegistry,
  pathParamNames,
  uniquenessKey,
} from '../src/index'
import type { AreaHandlers, EndpointResponse, HandlerFor, Handlers } from '../src/index'
import { getThing, twoEndpointRegistry } from './fixtures'
import type { createThing, deleteThing, fullRegistry } from './fixtures'

const base = {
  method: 'GET',
  auth: 'session',
  responses: { 200: z.strictObject({}) },
  errors: [],
  example: {},
  tags: ['t'],
} as const

describe('defineRegistry uniqueness (load-time)', () => {
  it('throws on two endpoints with the same id', () => {
    const a = defineEndpoint({ ...base, id: 'things.one', path: '/a' })
    const b = defineEndpoint({ ...base, id: 'things.one', path: '/b' })
    expect(() => defineRegistry([a, b])).toThrow(/duplicate endpoint id "things.one"/)
  })
  it('throws on two endpoints with the same method and normalised path', () => {
    const a = defineEndpoint({
      ...base,
      id: 'things.a',
      path: '/users/:id',
      params: z.strictObject({ id: Id }),
    })
    const b = defineEndpoint({
      ...base,
      id: 'things.b',
      path: '/users/:userId',
      params: z.strictObject({ userId: Id }),
    })
    expect(() => defineRegistry([a, b])).toThrow(RegistryError)
    expect(() => defineRegistry([a, b])).toThrow(/things\.a.*things\.b/)
  })
  it('folds case in static segments when checking collisions', () => {
    const a = defineEndpoint({ ...base, id: 'things.a', path: '/Users' })
    const b = defineEndpoint({ ...base, id: 'things.b', path: '/users' })
    expect(() => defineRegistry([a, b])).toThrow(/both claim/)
  })
  it('allows the same path with a different method, and a static route beside a param route', () => {
    const a = defineEndpoint({ ...base, id: 'things.a', path: '/users/me' })
    const b = defineEndpoint({
      ...base,
      id: 'things.b',
      path: '/users/:id',
      params: z.strictObject({ id: Id }),
    })
    const c = defineEndpoint({ ...base, id: 'things.c', method: 'POST', path: '/users/me' })
    expect(() => defineRegistry([a, b, c])).not.toThrow()
  })
  it('counts aliases in the collision check', () => {
    const a = defineEndpoint({ ...base, id: 'sys.a', path: '/healthz' })
    const b = defineEndpoint({ ...base, id: 'sys.b', path: '/other', aliases: ['/healthz'] })
    expect(() => defineRegistry([a, b])).toThrow(/both claim/)
  })
  it('looks endpoints up by id', () => {
    expect(twoEndpointRegistry.get('things.get')).toBe(getThing)
    expect(twoEndpointRegistry.has('nope.x')).toBe(false)
    expect(() => twoEndpointRegistry.get('nope.x')).toThrow(/unknown endpoint id/)
  })
})

describe('defineEndpoint validation', () => {
  it('rejects a malformed id, path, or auth level', () => {
    expect(() => defineEndpoint({ ...base, id: 'nodot', path: '/a' })).toThrow(
      /<area>\.<operation>/,
    )
    expect(() => defineEndpoint({ ...base, id: 'a.b', path: 'a' })).toThrow(/must start with/)
    expect(() => defineEndpoint({ ...base, id: 'a.b', path: '/a/' })).toThrow(/trailing/)
    expect(() =>
      defineEndpoint({ ...base, id: 'a.b', path: '/a', auth: 'admin' as never }),
    ).toThrow(/auth level/)
  })
  it('requires path params and the params schema to agree', () => {
    expect(() => defineEndpoint({ ...base, id: 'a.b', path: '/a/:id' })).toThrow(
      /do not match the params schema/,
    )
    expect(() =>
      defineEndpoint({ ...base, id: 'a.b', path: '/a/:id', params: z.strictObject({ other: Id }) }),
    ).toThrow(/do not match/)
    expect(() =>
      defineEndpoint({
        ...base,
        id: 'a.b',
        path: '/a/:id/:id',
        params: z.strictObject({ id: Id }),
      }),
    ).toThrow(/repeats/)
  })
  it('rejects a GET with a body, no 2xx response, bad error codes and no tags', () => {
    expect(() =>
      defineEndpoint({ ...base, id: 'a.b', path: '/a', body: z.strictObject({}) }),
    ).toThrow(/GET endpoints cannot/)
    expect(() =>
      defineEndpoint({ ...base, id: 'a.b', path: '/a', responses: { 404: null } }),
    ).toThrow(/2xx/)
    expect(() =>
      defineEndpoint({
        ...base,
        id: 'a.b',
        path: '/a',
        errors: [{ status: 409, code: 'BadCode' }],
      }),
    ).toThrow(/snake_case/)
    expect(() =>
      defineEndpoint({ ...base, id: 'a.b', path: '/a', errors: [{ status: 200, code: 'ok' }] }),
    ).toThrow(/4xx\/5xx/)
    expect(() => defineEndpoint({ ...base, id: 'a.b', path: '/a', tags: [] })).toThrow(/tag/)
  })
  it('exposes small path helpers', () => {
    expect(pathParamNames('/a/:x/b/:y_2')).toEqual(['x', 'y_2'])
    expect(uniquenessKey('GET', '/Users/:id/Orders/:oid')).toBe('GET /users/{}/orders/{}')
  })
})

describe('handler typing', () => {
  it('derives the handler input and the allowed responses from the endpoint', () => {
    type H = HandlerFor<typeof getThing>
    expectTypeOf<Parameters<H>[1]['params']>().toEqualTypeOf<{ thingId: string }>()
    expectTypeOf<Parameters<H>[1]['body']>().toEqualTypeOf<undefined>()
    expectTypeOf<EndpointResponse<typeof getThing>>().toEqualTypeOf<{
      status: 200
      body: { id: string; name: string; createdAt: string }
    }>()
  })
  it('allows body-less responses for 204 endpoints', () => {
    expectTypeOf<EndpointResponse<typeof deleteThing>>().toEqualTypeOf<{
      status: 204
      body?: undefined
    }>()
  })
  it('keys Handlers by endpoint id and restricts AreaHandlers to one area', () => {
    type All = Handlers<typeof fullRegistry>
    expectTypeOf<keyof All>().toEqualTypeOf<
      'things.get' | 'things.create' | 'things.list' | 'things.delete'
    >()
    type Area = AreaHandlers<typeof fullRegistry, 'things'>
    const ok: Area = {
      'things.get': async () => ({
        status: 200,
        body: {
          id: Id.parse('0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b'),
          name: 'n',
          createdAt: '2026-11-05T08:30:00.000Z',
        },
      }),
    }
    expect(ok).toBeDefined()
    const ping = defineEndpoint({ ...base, id: 'other.ping', path: '/ping' })
    const twoAreas = defineRegistry([getThing, ping])
    expect(twoAreas.has('other.ping')).toBe(true)
    const bad: AreaHandlers<typeof twoAreas, 'things'> = {
      // @ts-expect-error - 'other.ping' belongs to another area, so it is not a key of AreaHandlers<R, 'things'>
      'other.ping': async () => ({ status: 200, body: {} }),
    }
    expect(bad).toBeDefined()
    // @ts-expect-error - a response status the endpoint does not declare is rejected
    const wrongStatus: HandlerFor<typeof createThing> = async () => ({ status: 200, body: {} })
    expect(wrongStatus).toBeDefined()
  })
})
