// BLD-03: schema.infer and schema.preview, through the real app on a real Postgres (FND-11 tooling).
import { readFileSync } from 'node:fs'
import { LIMITS, validateSchema } from '@mockbench/schema-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp } from '../../testing'
import type { TestApp, TestSession } from '../../testing'
import { computePreview } from '../../../../web/src/features/preview/compute'
import { NIL_PROJECT_ID, handlers, limitIssueCode } from './schema'

const fixture = (name: string): string =>
  readFileSync(
    new URL(`../../../../../packages/schema-core/fixtures/${name}`, import.meta.url),
    'utf8',
  )
const workedExample = JSON.parse(fixture('worked-example.schema.json')) as Record<string, unknown>
// The committed schema-core golden is generated with this project id (generate.test.ts).
const GOLDEN_PROJECT_ID = '11111111-1111-7111-8111-111111111111'
const workedGolden = fixture('worked-example.deterministic-local.golden.txt')

const INFER = '/api/v1/schema/infer'
const PREVIEW = '/api/v1/schema/preview'

let t: TestApp
let me: TestSession
beforeAll(async () => {
  t = await testApp()
  me = await t.session()
})
afterAll(() => t?.drop())

const leaf = (type: string) => ({ type })
const obj = (...fields: [string, unknown][]) => ({
  type: 'object',
  fields: fields.map(([key, node]) => ({ key, node })),
})
const envelope = (root: unknown, components: Record<string, unknown> = {}) => ({
  version: 1,
  components,
  root,
})
const uuids = (json: string): string[] =>
  json.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []

describe('schema.infer', () => {
  it('infers a uuid node and warns about null at $.z (spec example)', async () => {
    const res = await t
      .as(me)
      .post(INFER)
      .send({ sample: { id: '8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f', z: null } })
    expect(res.status).toBe(200)
    t.assertContract('schema.infer', res)
    expect(res.body.schema.root.fields[0]).toEqual({ key: 'id', node: { type: 'uuid' } })
    expect(res.body.schema.root.fields[1]).toEqual({
      key: 'z',
      node: { type: 'string', nullable: true },
    })
    expect(res.body.warnings).toContainEqual(
      expect.objectContaining({ path: '$.z', code: 'null_value' }),
    )
  })

  it('every inferred schema is valid (it round-trips through the validator)', async () => {
    const res = await t
      .as(me)
      .post(INFER)
      .send({ sample: { a: 1, b: [{ c: 'x' }, { c: 'y', d: 2.5 }], e: { f: '2026-01-02' } } })
    expect(res.status).toBe(200)
    expect(validateSchema(res.body.schema).ok).toBe(true)
  })

  it('a root array and a root primitive are accepted', async () => {
    const arr = await t
      .as(me)
      .post(INFER)
      .send({ sample: [1, 2, 3] })
    expect(arr.status).toBe(200)
    expect(arr.body.schema.root).toMatchObject({ type: 'array', count: 3 })
    const prim = await t.as(me).post(INFER).send({ sample: 5 })
    expect(prim.status).toBe(200)
    expect(prim.body.schema.root.type).toBe('integer')
  })

  it('a sample nested deeper than the depth limit -> 422 depth_exceeded (never a 500)', async () => {
    let sample: unknown = 1
    for (let i = 0; i < LIMITS.maxDepth + 2; i++) sample = { a: sample }
    const res = await t.as(me).post(INFER).send({ sample })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('validation_failed')
    expect(res.body.details).toEqual([
      expect.objectContaining({ path: ['sample'], code: 'depth_exceeded' }),
    ])
  })

  it('a sample nested 500 levels deep (far past the limit) is still a clean 422 depth_exceeded', async () => {
    const depth = 500
    const body = `{"sample":${'['.repeat(depth)}1${']'.repeat(depth)}}`
    const res = await t.as(me).post(INFER).set('Content-Type', 'application/json').send(body)
    expect(res.status).toBe(422)
    expect(res.body.details[0]).toMatchObject({ path: ['sample'], code: 'depth_exceeded' })
  })

  it('a sample nested thousands of levels deep answers 422 depth_exceeded, never 500', async () => {
    // Found while building BLD-03; the generic body validation in http/control-plane.ts now turns the
    // stack overflow into a 422 (fixed on main in 43e6892).
    const deep = '['.repeat(3000) + ']'.repeat(3000)
    const res = await t
      .as(me)
      .post(INFER)
      .set('Content-Type', 'application/json')
      .send(`{"sample":${deep}}`)
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('validation_failed')
    expect(res.body.details[0]).toMatchObject({ code: 'depth_exceeded' })
  })

  it('an array longer than the limit -> 422 array_count_exceeded; too many nodes -> node_limit_exceeded', async () => {
    const longArray = await t
      .as(me)
      .post(INFER)
      .send({ sample: Array.from({ length: LIMITS.maxArrayCount + 1 }, (_, i) => i) })
    expect(longArray.status).toBe(422)
    expect(longArray.body.details[0].code).toBe('array_count_exceeded')

    const wide = Object.fromEntries(
      Array.from({ length: LIMITS.maxNodes + 50 }, (_, i) => [`k${i}`, i]),
    )
    const many = await t.as(me).post(INFER).send({ sample: wide })
    expect(many.status).toBe(422)
    expect(many.body.details[0].code).toBe('node_limit_exceeded')
  })

  it('a body over 1 MiB -> 413 payload_too_large', async () => {
    const big = JSON.stringify({ sample: 'x'.repeat(1024 * 1024) })
    expect(big.length).toBeGreaterThan(1024 * 1024)
    const res = await t.as(me).post(INFER).set('Content-Type', 'application/json').send(big)
    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ error: 'payload_too_large', details: [] })
  })

  it('rejects unknown body keys and a missing sample with 422', async () => {
    const extra = await t.as(me).post(INFER).send({ sample: 1, bogus: true })
    expect(extra.status).toBe(422)
    const missing = await t.as(me).post(INFER).send({})
    expect(missing.status).toBe(422)
  })
})

describe('schema.preview', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    schema: workedExample,
    settings: { indexing: 'local' },
    ...over,
  })

  it('returns the schema-core golden byte-for-byte (2-space indent) and generatorVersion 1', async () => {
    const res = await t
      .as(me)
      .post(PREVIEW)
      .send(body({ projectId: GOLDEN_PROJECT_ID }))
    expect(res.status).toBe(200)
    t.assertContract('schema.preview', res)
    expect(`${res.body.json}\n`).toBe(workedGolden)
    expect(res.body.generatorVersion).toBe(1)
  })

  it('with no projectId it is the same document as the golden apart from the uuids (nil project id)', async () => {
    const res = await t.as(me).post(PREVIEW).send(body())
    expect(res.status).toBe(200)
    const mask = (s: string) =>
      s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    expect(`${mask(res.body.json)}\n`).toBe(mask(workedGolden))
    expect(res.body.json).toContain('"name": "name-1"')
    expect(res.body.json).toContain('"role": "role-1"')
    expect(NIL_PROJECT_ID).toBe('00000000-0000-0000-0000-000000000000')
  })

  it('a projectId changes the uuids, and the same projectId repeats exactly', async () => {
    const without = await t.as(me).post(PREVIEW).send(body())
    const a = await t
      .as(me)
      .post(PREVIEW)
      .send(body({ projectId: GOLDEN_PROJECT_ID }))
    const b = await t
      .as(me)
      .post(PREVIEW)
      .send(body({ projectId: GOLDEN_PROJECT_ID }))
    expect(a.body.json).toBe(b.body.json)
    expect(uuids(a.body.json).length).toBeGreaterThan(0)
    expect(uuids(a.body.json)).not.toEqual(uuids(without.body.json))
    const again = await t.as(me).post(PREVIEW).send(body())
    expect(again.body.json).toBe(without.body.json)
  })

  it('indexing "path" is honoured; unspecified settings default to local + deterministic', async () => {
    const nested = envelope(
      obj([
        'users',
        {
          type: 'array',
          count: 2,
          items: obj(['tags', { type: 'array', count: 2, items: leaf('string') }]),
        },
      ]),
    )
    const local = await t.as(me).post(PREVIEW).send({ schema: nested })
    const path = await t
      .as(me)
      .post(PREVIEW)
      .send({ schema: nested, settings: { indexing: 'path' } })
    expect(JSON.parse(local.body.json).users[1].tags).toEqual(['tags-1', 'tags-2'])
    expect(JSON.parse(path.body.json).users[1].tags).toEqual(['users-2-tags-1', 'users-2-tags-2'])
  })

  it('mode "random" is accepted (output is valid JSON; stability is not promised)', async () => {
    const res = await t
      .as(me)
      .post(PREVIEW)
      .send({ schema: envelope(obj(['id', leaf('uuid')])), settings: { mode: 'random' } })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body.json)).toHaveProperty('id')
    const seeded = await t
      .as(me)
      .post(PREVIEW)
      .send({
        schema: envelope(obj(['name', leaf('string')])),
        settings: { mode: 'seeded' },
        projectId: GOLDEN_PROJECT_ID,
      })
    expect(seeded.status).toBe(200)
  })

  it('applies presets (value, values cycling) and project components', async () => {
    const schema = envelope(
      obj(
        ['currency', leaf('string')],
        ['people', { type: 'array', count: 3, items: { type: 'ref', name: 'Person' } }],
      ),
    )
    const res = await t
      .as(me)
      .post(PREVIEW)
      .send({
        schema,
        components: { Person: obj(['role', leaf('string')]) },
        presets: [
          {
            priority: 1,
            rules: [
              { match: { key: 'currency' }, value: 'INR' },
              { match: { key: 'role' }, values: ['admin', 'manager'] },
            ],
          },
        ],
      })
    expect(res.status).toBe(200)
    const out = JSON.parse(res.body.json)
    expect(out.currency).toBe('INR')
    expect(out.people.map((p: { role: string }) => p.role)).toEqual(['admin', 'manager', 'admin'])
  })

  it('an unknown ref -> 422 unknown_ref under the schema path; supplying the component fixes it', async () => {
    const schema = envelope(obj(['p', { type: 'ref', name: 'Missing' }]))
    const bad = await t.as(me).post(PREVIEW).send({ schema })
    expect(bad.status).toBe(422)
    expect(bad.body.error).toBe('validation_failed')
    expect(bad.body.details).toContainEqual(
      expect.objectContaining({ code: 'unknown_ref', path: expect.arrayContaining(['schema']) }),
    )
    const ok = await t
      .as(me)
      .post(PREVIEW)
      .send({ schema, components: { Missing: leaf('string') } })
    expect(ok.status).toBe(200)
  })

  it('an invalid schema lists the validator issues (duplicate key) with paths under `schema`', async () => {
    const dup = envelope(obj(['a', leaf('string')], ['a', leaf('integer')]))
    const res = await t.as(me).post(PREVIEW).send({ schema: dup })
    expect(res.status).toBe(422)
    const issue = res.body.details.find((d: { code: string }) => d.code === 'duplicate_key')
    expect(issue).toBeDefined()
    expect(issue.path[0]).toBe('schema')
    expect(issue.message).toBeTypeOf('string')
  })

  it('structurally wrong input (unknown node type, wrong version, unknown body key) -> 422', async () => {
    const badType = await t
      .as(me)
      .post(PREVIEW)
      .send({ schema: envelope({ type: 'wat' }) })
    expect(badType.status).toBe(422)
    const badVersion = await t
      .as(me)
      .post(PREVIEW)
      .send({ schema: { version: 2, components: {}, root: leaf('string') } })
    expect(badVersion.status).toBe(422)
    const extra = await t
      .as(me)
      .post(PREVIEW)
      .send({ schema: envelope(leaf('string')), bogus: 1 })
    expect(extra.status).toBe(422)
    expect(extra.body.details[0]).toMatchObject({ code: 'unrecognized_keys' })
  })

  it('a schema over the leaf limit -> 422 leaf_limit_exceeded, fast (no generation, no timeout)', async () => {
    const wide = envelope({
      type: 'array',
      count: 1000,
      items: { type: 'array', count: 1000, items: leaf('string') },
    })
    const started = Date.now()
    const res = await t.as(me).post(PREVIEW).send({ schema: wide })
    const took = Date.now() - started
    expect(res.status).toBe(422)
    expect(res.body.details).toContainEqual(
      expect.objectContaining({ code: 'leaf_limit_exceeded' }),
    )
    expect(took).toBeLessThan(2000)
  })

  it('schema depth over the limit -> 422 depth_exceeded', async () => {
    let node: unknown = leaf('string')
    for (let i = 0; i < LIMITS.maxDepth + 1; i++) node = obj(['a', node])
    const res = await t
      .as(me)
      .post(PREVIEW)
      .send({ schema: envelope(node) })
    expect(res.status).toBe(422)
    expect(res.body.details).toContainEqual(expect.objectContaining({ code: 'depth_exceeded' }))
  })

  it('unknown keys on nodes are preserved and ignored (reserved `source` key)', async () => {
    const schema = envelope(
      obj(['id', { type: 'string', source: { from: 'path', name: 'id' }, 'x-vendor': 1 }]),
    )
    const res = await t.as(me).post(PREVIEW).send({ schema })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body.json)).toEqual({ id: 'id-1' })
  })
})

describe('authentication and roles', () => {
  it('both endpoints need a session: no cookie -> 401 unauthenticated envelope', async () => {
    for (const [path, send] of [
      [INFER, { sample: 1 }],
      [PREVIEW, { schema: envelope(leaf('string')) }],
    ] as const) {
      const res = await t.as().post(path).send(send)
      expect(res.status, path).toBe(401)
      expect(res.body).toMatchObject({ error: 'unauthenticated', details: [] })
    }
  })

  it('a tampered cookie is 401; the CSRF header is still required', async () => {
    const res = await t
      .as({ cookie: 'mockbench_session=not-a-real-token' })
      .post(INFER)
      .send({ sample: 1 })
    expect(res.status).toBe(401)
    const csrf = await t.as(me).post(INFER).unset('X-Mockbench-Client').send({ sample: 1 })
    expect(csrf.status).toBe(403)
    expect(csrf.body.error).toBe('csrf_rejected')
  })

  it('any role works: viewer, editor, owner and a user in no workspace at all', async () => {
    const ws = await t.f.createWorkspace()
    const sessions = [await t.session()] // no membership
    for (const role of ['viewer', 'editor', 'owner'] as const) {
      const user = await t.f.createUser()
      await t.f.createMember({ workspaceId: ws.id, userId: user.id, role })
      sessions.push(await t.session(user.id))
    }
    for (const s of sessions) {
      const res = await t
        .as(s)
        .post(INFER)
        .send({ sample: { a: 1 } })
      expect(res.status).toBe(200)
      const prev = await t
        .as(s)
        .post(PREVIEW)
        .send({ schema: envelope(obj(['a', leaf('integer')])) })
      expect(prev.status).toBe(200)
    }
  })
})

describe('no database access', () => {
  it('the handlers never touch the database (a context whose db and pool throw on any use)', async () => {
    const explode = new Proxy(
      {},
      {
        get() {
          throw new Error('the database was used')
        },
      },
    )
    const ctx = { db: explode, pool: explode } as never
    const infer = await handlers['schema.infer']!(ctx, {
      params: undefined,
      query: undefined,
      body: { sample: { id: 'a', n: 1 } },
    } as never)
    expect(infer.status).toBe(200)
    const preview = await handlers['schema.preview']!(ctx, {
      params: undefined,
      query: undefined,
      body: { schema: workedExample },
    } as never)
    expect(preview.status).toBe(200)
  })

  it('over HTTP the only SQL a request issues is the session lookup (query counter)', async () => {
    const sqls: string[] = []
    const text = (q: unknown) =>
      typeof q === 'string' ? q : ((q as { text?: string })?.text ?? '')
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const pool = t.pool as any
    const origQuery = pool.query.bind(pool)
    const origConnect = pool.connect.bind(pool)
    pool.query = (...a: any[]) => (sqls.push(text(a[0])), origQuery(...a))
    pool.connect = async (...a: any[]) => {
      const client = await origConnect(...a)
      if (a.length === 0 || typeof a[0] !== 'function') {
        const q = client.query.bind(client)
        client.query = (...qa: any[]) => (sqls.push(text(qa[0])), q(...qa))
      }
      return client
    }
    try {
      const a = await t
        .as(me)
        .post(INFER)
        .send({ sample: { a: 1 } })
      const b = await t.as(me).post(PREVIEW).send({ schema: workedExample })
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
    } finally {
      pool.query = origQuery
      pool.connect = origConnect
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    expect(sqls.length).toBeGreaterThan(0) // the session lookup is real SQL
    for (const sql of sqls) {
      expect(sql, sql).toMatch(/"sessions"|"users"/) // session resolution only
      expect(sql).not.toMatch(/"(projects|routes|response_cases|data_presets|versions|workspaces)"/)
    }
  })
})

describe('limitIssueCode (pins the wording of schema-core limit messages)', () => {
  it('maps every limit message to its machine code', () => {
    expect(limitIssueCode(`nested more than ${LIMITS.maxDepth} levels`)).toBe('depth_exceeded')
    expect(limitIssueCode(`Nesting is deeper than ${LIMITS.maxDepth} levels`)).toBe(
      'depth_exceeded',
    )
    expect(limitIssueCode(`an array longer than ${LIMITS.maxArrayCount}`)).toBe(
      'array_count_exceeded',
    )
    expect(limitIssueCode(`Would generate more than ${LIMITS.maxLeaves} values`)).toBe(
      'leaf_limit_exceeded',
    )
    expect(limitIssueCode(`more than ${LIMITS.maxNodes} nodes`)).toBe('node_limit_exceeded')
    expect(limitIssueCode('something else entirely')).toBe('node_limit_exceeded')
  })
})

// BLD-11: the browser preview (apps/web/src/features/preview/compute.ts) must produce the same
// document the server does for the same inputs.
describe('schema.preview vs the web live preview (BLD-11)', () => {
  const rules = [{ match: { key: 'role' }, value: 'admin' }]
  const cases = [
    { settings: { indexing: 'local', mode: 'deterministic' }, presets: [] },
    { settings: { indexing: 'path', mode: 'seeded' }, presets: [] },
    { settings: { indexing: 'local', mode: 'deterministic' }, presets: [{ priority: 5, rules }] },
  ] as const

  it.each(cases)('is identical for %j', async ({ settings, presets }) => {
    const res = await t
      .as(me)
      .post(PREVIEW)
      .send({ schema: workedExample, settings, presets, projectId: GOLDEN_PROJECT_ID })
    expect(res.status).toBe(200)
    const local = computePreview({
      schema: workedExample,
      projectId: GOLDEN_PROJECT_ID,
      settings: { ...settings },
      components: {},
      presets: presets.map((p) => ({ priority: p.priority, rules: [...p.rules] })),
    })
    expect(local.kind).toBe('ok')
    expect(local.kind === 'ok' && local.json).toBe(res.body.json)
  })
})
