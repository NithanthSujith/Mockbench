// RUN-01: the snapshot + bake service, against a real Postgres (FND-09 harness) and the FND-11 factories.
import { ProjectSettings, Snapshot } from '@mockbench/api-contract'
import { GENERATOR_VERSION, buildPresetResolver, generate } from '@mockbench/schema-core'
import type { MockNode, MockSchema } from '@mockbench/schema-core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dataPresets, projects, responseCases, routes } from '../../db/schema'
import { withTestDb } from '../../db/testing'
import type { TestDb } from '../../db/testing'
import { createCase, createPreset, createProject, createRoute } from '../../testing'
import type { PublishIssue } from './snapshot'
import {
  EmptyProjectError,
  ProjectNotFoundError,
  PublishInvalidError,
  buildVersionPayload,
} from './snapshot'

let t: TestDb
beforeAll(async () => {
  t = await withTestDb()
})
afterAll(() => t?.drop())

const leaf = (type: string, extra: Record<string, unknown> = {}): MockNode =>
  ({ type, ...extra }) as MockNode
const obj = (...fields: [string, MockNode][]): MockNode => ({
  type: 'object',
  fields: fields.map(([key, node]) => ({ key, node })),
})
const env = (root: MockNode, components: Record<string, MockNode> = {}): MockSchema => ({
  version: 1,
  components,
  root,
})

/** A small but varied schema: uuid + email + a nested array, so determinism and ordinals matter. */
const userSchema = env(
  obj(
    ['id', leaf('uuid')],
    ['email', leaf('email')],
    ['currency', leaf('string')],
    ['tags', { type: 'array', count: 3, items: leaf('string') }],
  ),
)

/** Builds a project with the given routes. Each route is [method, path, cases[]]. */
async function projectWith(
  routesSpec: [string, string, { name: string; status?: number; schema?: MockSchema }[]][],
  projectOverrides: Parameters<typeof createProject>[1] = {},
) {
  const project = await createProject(t.db, projectOverrides)
  for (const [method, path, cases] of routesSpec) {
    const route = await createRoute(t.db, {
      projectId: project.id,
      method,
      path,
      withDefaultCase: false,
    })
    for (const [i, c] of cases.entries()) {
      await createCase(t.db, {
        routeId: route.id,
        name: c.name,
        statusCode: c.status ?? 200,
        schema: c.schema ?? userSchema,
        isDefault: i === 0,
      })
    }
  }
  return project
}

const THREE_ROUTES: Parameters<typeof projectWith>[0] = [
  ['GET', '/users', [{ name: 'List' }, { name: 'Unauthorized', status: 401 }]],
  ['GET', '/users/:id', [{ name: 'Found' }, { name: 'Not found', status: 404 }]],
  ['DELETE', '/users/:id', [{ name: 'Deleted', status: 204 }]],
]

describe('buildVersionPayload: shape', () => {
  it('3 routes / 5 cases: the snapshot validates against the registry Snapshot schema', async () => {
    const project = await projectWith(THREE_ROUTES)
    const out = await buildVersionPayload(t.db, project.id)
    expect(out.routeCount).toBe(3)
    expect(out.caseCount).toBe(5)
    expect(() => Snapshot.parse(out.snapshot)).not.toThrow()
    expect(out.snapshot.schemaVersion).toBe(1)
    expect(out.snapshot.generatorVersion).toBe(GENERATOR_VERSION)
    expect(out.snapshot.project).toMatchObject({ id: project.id, slug: project.slug })
    // Routes and cases come out in sortOrder, i.e. creation order here.
    expect(out.snapshot.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /users',
      'GET /users/:id',
      'DELETE /users/:id',
    ])
    expect(out.snapshot.routes[1]?.cases.map((c) => c.name)).toEqual(['Found', 'Not found'])
    expect(out.snapshot.routes[0]?.cases.map((c) => c.isDefault)).toEqual([true, false])
  })

  it('reports byte sizes that match the serialised snapshot and baked text', async () => {
    const project = await projectWith(THREE_ROUTES)
    const out = await buildVersionPayload(t.db, project.id)
    expect(out.snapshotBytes).toBe(Buffer.byteLength(JSON.stringify(out.snapshot)))
    expect(out.baked).not.toBeNull()
    expect(out.bakedBytes).toBe(Buffer.byteLength(out.baked!))
  })

  it('fills missing settings with the defaults', async () => {
    const project = await projectWith(THREE_ROUTES, { settings: {} })
    const out = await buildVersionPayload(t.db, project.id)
    expect(out.snapshot.project.settings).toEqual({
      indexing: 'local',
      mode: 'deterministic',
      cors: '*',
      defaultDelayMs: 0,
    })
    expect(() => ProjectSettings.parse(out.snapshot.project.settings)).not.toThrow()
  })
})

describe('buildVersionPayload: baking', () => {
  it('baking twice from an unchanged draft is byte-identical (including UUIDs)', async () => {
    const project = await projectWith(THREE_ROUTES)
    const a = await buildVersionPayload(t.db, project.id)
    const b = await buildVersionPayload(t.db, project.id)
    expect(a.baked).toBe(b.baked)
    expect(JSON.stringify(a.snapshot)).toBe(JSON.stringify(b.snapshot))
    expect(a.baked).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-/) // a UUID v5 is in there
  })

  it('every baked entry equals an independent generate() of the same case (preview/bake equivalence)', async () => {
    const preset = await createPreset(t.db, {
      projectId: (await projectWith([])).id,
    })
    void preset
    const project = await projectWith(THREE_ROUTES, {
      settings: { indexing: 'path', mode: 'seeded', cors: '*', defaultDelayMs: 0 },
    })
    await createPreset(t.db, {
      projectId: project.id,
      rules: [{ match: { key: 'currency' }, value: 'INR' }],
      priority: 5,
    })
    const out = await buildVersionPayload(t.db, project.id)
    const baked = JSON.parse(out.baked!) as Record<string, string>

    // Independently, from the database rows (not from the snapshot the service built).
    const routeRows = await t.db.select().from(routes).where(eq(routes.projectId, project.id))
    const caseRows = await t.db
      .select({ c: responseCases })
      .from(responseCases)
      .innerJoin(routes, eq(responseCases.routeId, routes.id))
      .where(eq(routes.projectId, project.id))
    const rows = routeRows.map((r) => ({
      ...r,
      cases: caseRows.filter((x) => x.c.routeId === r.id).map((x) => x.c),
    }))
    const presets = await t.db
      .select()
      .from(dataPresets)
      .where(eq(dataPresets.projectId, project.id))
    const ctx = {
      projectId: project.id,
      settings: { indexing: 'path' as const, mode: 'seeded' as const },
      components: {},
      presets: buildPresetResolver(
        presets.map((p) => ({ priority: p.priority, rules: p.rules as never })),
      ),
    }
    let checked = 0
    for (const route of rows) {
      for (const c of route.cases) {
        const expected = c.statusCode === 204 ? '' : generate(c.schema as MockSchema, ctx).json
        expect(baked[`${route.id}:${c.id}`], `${route.method} ${route.path} ${c.name}`).toBe(
          expected,
        )
        checked++
      }
    }
    expect(checked).toBe(5)
    expect(Object.keys(baked)).toHaveLength(5)
  })

  it('uses presets: an enabled currency -> INR rule shows up, a disabled one does not', async () => {
    const project = await projectWith([['GET', '/x', [{ name: 'OK' }]]])
    await createPreset(t.db, {
      projectId: project.id,
      name: 'on',
      rules: [{ match: { key: 'currency' }, value: 'INR' }],
      isEnabled: true,
    })
    const disabled = await createPreset(t.db, {
      projectId: project.id,
      name: 'off',
      rules: [{ match: { key: 'currency' }, value: 'USD' }],
      isEnabled: false,
      priority: 99,
    })
    const out = await buildVersionPayload(t.db, project.id)
    expect(out.snapshot.presets.map((p) => p.name)).toEqual(['on'])
    expect(out.snapshot.presets.some((p) => p.id === disabled.id)).toBe(false)
    expect(out.baked).toContain('INR')
    expect(out.baked).not.toContain('USD')
  })

  it('orders presets by priority (highest first), then creation order', async () => {
    const project = await projectWith([['GET', '/x', [{ name: 'OK' }]]])
    await createPreset(t.db, { projectId: project.id, name: 'low', priority: 1 })
    await createPreset(t.db, { projectId: project.id, name: 'high', priority: 10 })
    await createPreset(t.db, { projectId: project.id, name: 'low-later', priority: 1 })
    const out = await buildVersionPayload(t.db, project.id)
    expect(out.snapshot.presets.map((p) => p.name)).toEqual(['high', 'low', 'low-later'])
  })

  it('mode: random returns baked null; deterministic and seeded return text; 204 bakes to ""', async () => {
    const det = await buildVersionPayload(
      t.db,
      (await projectWith(THREE_ROUTES, { settings: { mode: 'deterministic' } })).id,
    )
    const seeded = await buildVersionPayload(
      t.db,
      (await projectWith(THREE_ROUTES, { settings: { mode: 'seeded' } })).id,
    )
    const random = await buildVersionPayload(
      t.db,
      (await projectWith(THREE_ROUTES, { settings: { mode: 'random' } })).id,
    )
    expect(typeof det.baked).toBe('string')
    expect(typeof seeded.baked).toBe('string')
    expect(random.baked).toBeNull()
    expect(random.bakedBytes).toBe(0)
    // The snapshot is still complete in random mode (the data plane generates from it).
    expect(random.caseCount).toBe(5)

    const bodies = JSON.parse(det.baked!) as Record<string, string>
    const deleted = det.snapshot.routes[2]!.cases[0]!
    expect(bodies[`${det.snapshot.routes[2]!.id}:${deleted.id}`]).toBe('')
    const first = det.snapshot.routes[0]!
    expect(JSON.parse(bodies[`${first.id}:${first.cases[0]!.id}`]!)).toHaveProperty('email')
  })

  it('local and path indexing both bake, and differ', async () => {
    const nested = env(
      obj([
        'users',
        {
          type: 'array',
          count: 2,
          items: obj(['tags', { type: 'array', count: 2, items: leaf('string') }]),
        },
      ]),
    )
    const spec: Parameters<typeof projectWith>[0] = [
      ['GET', '/n', [{ name: 'OK', schema: nested }]],
    ]
    const local = await buildVersionPayload(t.db, (await projectWith(spec)).id)
    const path = await buildVersionPayload(
      t.db,
      (await projectWith(spec, { settings: { indexing: 'path' } })).id,
    )
    expect(local.baked).toContain('tags-1')
    expect(path.baked).toContain('users-2-tags-1')
  })

  it('resolves refs against the project components, and embeds them in the snapshot', async () => {
    const components = { Address: obj(['city', leaf('string')]) }
    const schema = env(obj(['home', { type: 'ref', name: 'Address' }]))
    const project = await projectWith([['GET', '/a', [{ name: 'OK', schema }]]], { components })
    const out = await buildVersionPayload(t.db, project.id)
    expect(out.snapshot.project.components).toEqual(components)
    expect(out.baked).toContain('city-1')
  })
})

describe('buildVersionPayload: validation failures', () => {
  const deep = (levels: number): MockNode => {
    let node: MockNode = leaf('string')
    for (let i = 0; i < levels; i++) node = obj(['x', node])
    return node
  }

  it('collects EVERY offending case (unknown_ref and depth_exceeded) and bakes nothing', async () => {
    const project = await projectWith([
      ['GET', '/good', [{ name: 'Fine' }]],
      [
        'GET',
        '/bad-ref',
        [{ name: 'Missing ref', schema: env(obj(['a', { type: 'ref', name: 'Nope' }])) }],
      ],
      ['POST', '/bad-depth', [{ name: 'Too deep', schema: env(deep(12)) }]],
    ])
    const err = await buildVersionPayload(t.db, project.id).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(PublishInvalidError)
    const details = (err as PublishInvalidError).details
    expect(details).toHaveLength(2)
    const byName: Record<string, PublishIssue> = Object.fromEntries(
      details.map((d) => [d.caseName ?? '', d]),
    )
    expect(byName['Missing ref']).toMatchObject({ method: 'GET', path: '/bad-ref' })
    expect(byName['Missing ref']!.issues.map((i) => i.code)).toContain('unknown_ref')
    expect(byName['Too deep']).toMatchObject({ method: 'POST', path: '/bad-depth' })
    expect(byName['Too deep']!.issues.map((i) => i.code)).toContain('depth_exceeded')
    // Each entry names the route, the case and the path into the schema.
    for (const d of details) {
      expect(d.routeId).toMatch(/^[0-9a-f-]{36}$/)
      expect(d.caseId).toMatch(/^[0-9a-f-]{36}$/)
      expect(d.issues.every((i) => Array.isArray(i.path) && i.message.length > 0)).toBe(true)
    }
    expect(err).not.toHaveProperty('baked')
  })

  it('rejects a leaf-limit schema at validation, never at baking', async () => {
    const huge = env({
      type: 'array',
      count: 1000,
      items: { type: 'array', count: 1000, items: leaf('string') },
    } as MockNode)
    const project = await projectWith([['GET', '/huge', [{ name: 'Huge', schema: huge }]]])
    const err = (await buildVersionPayload(t.db, project.id).catch(
      (e: unknown) => e,
    )) as PublishInvalidError
    expect(err).toBeInstanceOf(PublishInvalidError)
    expect(err.details[0]!.issues.map((i) => i.code)).toContain('leaf_limit_exceeded')
  })

  it('a schema that passes validation bakes without throwing, even right at the leaf limit', async () => {
    // 1,000 x 50 = 50,000 leaves: exactly the cap.
    const atLimit = env({
      type: 'array',
      count: 1000,
      items: { type: 'array', count: 50, items: leaf('integer') },
    } as MockNode)
    const project = await projectWith([['GET', '/edge', [{ name: 'Edge', schema: atLimit }]]])
    const out = await buildVersionPayload(t.db, project.id)
    expect(out.bakedBytes).toBeGreaterThan(100_000)
  })

  it('an empty project throws EmptyProjectError, an unknown id throws ProjectNotFoundError', async () => {
    const empty = await createProject(t.db)
    await expect(buildVersionPayload(t.db, empty.id)).rejects.toBeInstanceOf(EmptyProjectError)
    await expect(
      buildVersionPayload(t.db, '018f0000-0000-7000-8000-000000000000'),
    ).rejects.toBeInstanceOf(ProjectNotFoundError)
  })

  it('a route with no cases is reported, with a null case', async () => {
    const project = await createProject(t.db)
    const route = await createRoute(t.db, { projectId: project.id, withDefaultCase: false })
    const err = (await buildVersionPayload(t.db, project.id).catch(
      (e: unknown) => e,
    )) as PublishInvalidError
    expect(err).toBeInstanceOf(PublishInvalidError)
    expect(err.details).toEqual([
      expect.objectContaining({
        routeId: route.id,
        caseId: null,
        caseName: null,
        issues: [expect.objectContaining({ code: 'route_has_no_cases' })],
      }),
    ])
  })
})

describe('buildVersionPayload: fidelity and isolation', () => {
  it('preserves unknown node keys (source, x-vendor) unchanged in the snapshot', async () => {
    const schema = env(
      obj([
        'id',
        leaf('string', { source: { from: 'path', name: 'id' }, 'x-vendor': { keep: [1, 2, 3] } }),
      ]),
    )
    const project = await projectWith([['GET', '/u/:id', [{ name: 'OK', schema }]]])
    const out = await buildVersionPayload(t.db, project.id)
    const stored = out.snapshot.routes[0]!.cases[0]!.schema as unknown as MockSchema
    const node = (stored.root as { fields: { node: Record<string, unknown> }[] }).fields[0]!.node
    expect(node.source).toEqual({ from: 'path', name: 'id' })
    expect(node['x-vendor']).toEqual({ keep: [1, 2, 3] })
  })

  it('is self-contained: baking from the snapshot alone reproduces baked, and later edits change nothing already built', async () => {
    const components = { Money: obj(['amount', leaf('number')]) }
    const schema = env(obj(['currency', leaf('string')], ['price', { type: 'ref', name: 'Money' }]))
    const project = await projectWith([['GET', '/p', [{ name: 'OK', schema }]]], { components })
    const preset = await createPreset(t.db, {
      projectId: project.id,
      rules: [{ match: { key: 'currency' }, value: 'INR' }],
    })
    const first = await buildVersionPayload(t.db, project.id)
    const firstSnapshot = JSON.stringify(first.snapshot)
    const firstBaked = first.baked

    // The snapshot alone (embedded components + presets) is enough to reproduce the baked text.
    const snap = first.snapshot
    const fromSnapshot = generate(snap.routes[0]!.cases[0]!.schema as unknown as MockSchema, {
      projectId: snap.project.id,
      settings: { indexing: snap.project.settings.indexing, mode: 'deterministic' },
      components: snap.project.components,
      presets: buildPresetResolver(
        snap.presets.map((p) => ({ priority: p.priority, rules: p.rules })),
      ),
    }).json
    expect(JSON.parse(firstBaked!)[`${snap.routes[0]!.id}:${snap.routes[0]!.cases[0]!.id}`]).toBe(
      fromSnapshot,
    )

    // Edit the preset and the component afterwards.
    await t.db
      .update(dataPresets)
      .set({ rules: [{ match: { key: 'currency' }, value: 'EUR' }] })
      .where(eq(dataPresets.id, preset.id))
    await t.db
      .update(projects)
      .set({ components: { Money: obj(['cents', leaf('integer')]) } })
      .where(eq(projects.id, project.id))

    expect(JSON.stringify(first.snapshot)).toBe(firstSnapshot)
    expect(first.baked).toBe(firstBaked)
    expect(first.baked).toContain('INR')

    // A fresh build does see the edits (so the previous equality is not vacuous).
    const second = await buildVersionPayload(t.db, project.id)
    expect(second.baked).toContain('EUR')
    expect(second.baked).toContain('cents')
    expect(second.baked).not.toBe(firstBaked)
  })

  it('reads through the provided transaction, not the pool', async () => {
    const project = await projectWith([['GET', '/a', [{ name: 'OK' }]]])
    await t.db
      .transaction(async (tx) => {
        // Uncommitted here: invisible to any other connection, visible to the service only if it
        // really uses `tx`.
        const route = await createRoute(tx as never, { projectId: project.id, path: '/in-tx' })
        void route
        const out = await buildVersionPayload(tx, project.id)
        expect(out.snapshot.routes.map((r) => r.path)).toContain('/in-tx')
        throw new Error('rollback')
      })
      .catch((e: Error) => expect(e.message).toBe('rollback'))
    const after = await buildVersionPayload(t.db, project.id)
    expect(after.snapshot.routes.map((r) => r.path)).not.toContain('/in-tx')
  })

  it('does not see a row committed by another connection after a REPEATABLE READ transaction began', async () => {
    const project = await projectWith([['GET', '/a', [{ name: 'OK' }]]])
    const seen = await t.db.transaction(
      async (tx) => {
        await tx.select().from(projects).where(eq(projects.id, project.id)) // start the snapshot
        await createRoute(t.db, { projectId: project.id, path: '/late' }) // commits elsewhere
        return (await buildVersionPayload(tx, project.id)).snapshot.routes.map((r) => r.path)
      },
      { isolationLevel: 'repeatable read' },
    )
    expect(seen).toEqual(['/a'])
    // Outside that transaction the late route is of course there.
    const now = await buildVersionPayload(t.db, project.id)
    expect(now.snapshot.routes.map((r) => r.path)).toEqual(['/a', '/late'])
  })

  it('responseCases stay untouched by building a payload (read-only)', async () => {
    const project = await projectWith(THREE_ROUTES)
    const before = await t.db.select().from(responseCases)
    await buildVersionPayload(t.db, project.id)
    const after = await t.db.select().from(responseCases)
    expect(after).toEqual(before)
  })
})
