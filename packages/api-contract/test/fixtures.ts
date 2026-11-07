// A small registry used by the FND-06 tests. The real endpoints are FND-07's job.
import { z } from 'zod'
import { Id, PageQuery, Timestamp, defineEndpoint, defineRegistry, paginated } from '../src/index'

export const Thing = z.strictObject({ id: Id, name: z.string(), createdAt: Timestamp })

const ID = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b'
const TS = '2026-11-05T08:30:00.000Z'
const thing = { id: ID, name: 'widget', createdAt: TS }

export const getThing = defineEndpoint({
  id: 'things.get',
  method: 'GET',
  path: '/things/:thingId',
  auth: 'viewer',
  params: z.strictObject({ thingId: Id }),
  responses: { 200: Thing },
  errors: [],
  example: { response: thing },
  tags: ['things'],
})

export const createThing = defineEndpoint({
  id: 'things.create',
  method: 'POST',
  path: '/things',
  auth: 'editor',
  body: z.strictObject({ name: z.string().min(1) }),
  responses: { 201: Thing },
  errors: [{ status: 409, code: 'name_taken' }],
  example: { request: { name: 'widget' }, response: thing },
  tags: ['things'],
})

export const listThings = defineEndpoint({
  id: 'things.list',
  method: 'GET',
  path: '/things',
  auth: 'session',
  query: PageQuery,
  responses: { 200: paginated(Thing) },
  errors: [],
  example: { response: { items: [thing], nextCursor: null } },
  tags: ['things'],
})

export const deleteThing = defineEndpoint({
  id: 'things.delete',
  method: 'DELETE',
  path: '/things/:thingId',
  auth: 'owner',
  params: z.strictObject({ thingId: Id }),
  responses: { 204: null },
  errors: [{ status: 409, code: 'thing_in_use' }],
  example: {},
  tags: ['things'],
})

export const twoEndpointRegistry = defineRegistry([getThing, createThing])
export const fullRegistry = defineRegistry([getThing, createThing, listThings, deleteThing])
