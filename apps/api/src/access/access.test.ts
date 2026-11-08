// FND-11: the role matrix for every loader, the one-query guarantee, and the permissions table.
import { AUTH_LEVELS, registry } from '@mockbench/api-contract'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../db/client'
import { withTestDb } from '../db/testing'
import type { TestDb } from '../db/testing'
import * as schema from '../db/schema'
import { HttpError } from '../http/errors'
import { factories } from '../testing/factories'
import type { Factories } from '../testing/factories'
import {
  AUTH_POLICY,
  ROLES,
  createAccess,
  getMembership,
  loadCaseForUser,
  loadDeploymentForUser,
  loadPresetForUser,
  loadProjectForUser,
  loadRouteForUser,
  loadVersionForUser,
  loadWorkspaceForUser,
  minRoleFor,
  requireRole,
  requireWorkspaceRole,
  roleAtLeast,
} from './index'
import type { Role } from './index'

const RANDOM_UUID = '0190f3a2-7b1c-7d4e-8a5b-123456789abc'

let t: TestDb
let f: Factories
let counted: { db: Db; count: () => number; reset: () => void }

// Actors: one user per role in workspace W; an outsider who belongs to a DIFFERENT workspace (so
// "not a member" is tested against a user who has memberships elsewhere, the realistic leak case);
// and a valid-looking user id that has no row at all.
let actors: Record<'owner' | 'editor' | 'viewer' | 'outsider' | 'ghost', string>
let ids: Record<
  'workspace' | 'project' | 'route' | 'case' | 'preset' | 'version' | 'deployment',
  string
>

// Written out literally on purpose: the expectation must not be computed by the code under test.
const EXPECTED: Record<'owner' | 'editor' | 'viewer', Record<Role, boolean>> = {
  owner: { viewer: true, editor: true, owner: true },
  editor: { viewer: true, editor: true, owner: false },
  viewer: { viewer: true, editor: false, owner: false },
}

type Loader = (db: Db, userId: string, id: string, min: Role) => Promise<unknown>
const LOADERS: { name: keyof typeof ids; load: Loader }[] = [
  { name: 'workspace', load: loadWorkspaceForUser },
  { name: 'project', load: loadProjectForUser },
  { name: 'route', load: loadRouteForUser },
  { name: 'case', load: loadCaseForUser },
  { name: 'preset', load: loadPresetForUser },
  { name: 'version', load: loadVersionForUser },
  { name: 'deployment', load: loadDeploymentForUser },
]

beforeAll(async () => {
  t = await withTestDb()
  f = factories(t.db)

  const ws = await f.createWorkspace()
  const other = await f.createWorkspace()
  const owner = await f.createUser()
  const editor = await f.createUser()
  const viewer = await f.createUser()
  const outsider = await f.createUser()
  await f.createMember({ workspaceId: ws.id, userId: owner.id, role: 'owner' })
  await f.createMember({ workspaceId: ws.id, userId: editor.id, role: 'editor' })
  await f.createMember({ workspaceId: ws.id, userId: viewer.id, role: 'viewer' })
  await f.createMember({ workspaceId: other.id, userId: outsider.id, role: 'owner' })
  actors = {
    owner: owner.id,
    editor: editor.id,
    viewer: viewer.id,
    outsider: outsider.id,
    ghost: RANDOM_UUID,
  }

  const project = await f.createProject({ workspaceId: ws.id })
  const route = await f.createRoute({ projectId: project.id })
  const kase = await f.createCase({ routeId: route.id })
  const preset = await f.createPreset({ projectId: project.id })
  const version = await f.createVersion({ projectId: project.id })
  const deployment = await f.createDeployment({ projectId: project.id, versionId: version.id })
  ids = {
    workspace: ws.id,
    project: project.id,
    route: route.id,
    case: kase.id,
    preset: preset.id,
    version: version.id,
    deployment: deployment.id,
  }

  // A second Drizzle instance over the same pool whose logger counts every SQL statement issued.
  let n = 0
  const db = drizzle(t.pool, { schema, logger: { logQuery: () => void n++ } })
  counted = { db, count: () => n, reset: () => void (n = 0) }
})

afterAll(() => t?.drop())

async function outcome(
  p: Promise<unknown>,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; code: string }> {
  try {
    return { ok: true, value: await p }
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, status: e.status, code: e.code }
    throw e
  }
}

describe('role matrix: every loader x every actor x every minimum role', () => {
  for (const { name, load } of LOADERS) {
    describe(`load${name[0]!.toUpperCase()}${name.slice(1)}ForUser`, () => {
      for (const actor of ['owner', 'editor', 'viewer'] as const) {
        for (const min of ROLES) {
          const allowed = EXPECTED[actor][min]
          it(`${actor} with min ${min}: ${allowed ? 'allowed' : '403 forbidden'}`, async () => {
            const r = await outcome(load(t.db, actors[actor], ids[name], min))
            if (allowed) {
              expect(r.ok).toBe(true)
              const v = (
                r as { value: { role: Role; workspaceId: string; entity: { id: string } } }
              ).value
              expect(v.role).toBe(actor)
              expect(v.workspaceId).toBe(ids.workspace)
              expect(v.entity.id).toBe(ids[name])
            } else {
              expect(r).toEqual({ ok: false, status: 403, code: 'forbidden' })
            }
          })
        }
      }

      for (const min of ROLES) {
        it(`a member of ANOTHER workspace gets 404 not_found (min ${min}), never 403`, async () => {
          expect(await outcome(load(t.db, actors.outsider, ids[name], min))).toEqual({
            ok: false,
            status: 404,
            code: 'not_found',
          })
        })
        it(`a user id with no account gets 404 not_found (min ${min})`, async () => {
          expect(await outcome(load(t.db, actors.ghost, ids[name], min))).toEqual({
            ok: false,
            status: 404,
            code: 'not_found',
          })
        })
        it(`a random valid id gets 404 not_found for an owner (min ${min})`, async () => {
          expect(await outcome(load(t.db, actors.owner, RANDOM_UUID, min))).toEqual({
            ok: false,
            status: 404,
            code: 'not_found',
          })
        })
      }

      it('a malformed id is 404 without touching the database', async () => {
        counted.reset()
        for (const bad of ['', 'nope', '12345', "' or 1=1 --", `${ids[name]}x`]) {
          expect(await outcome(load(counted.db, actors.owner, bad, 'viewer'))).toEqual({
            ok: false,
            status: 404,
            code: 'not_found',
          })
        }
        expect(counted.count()).toBe(0)
      })

      it('issues exactly ONE SQL query on success, on 403 and on 404', async () => {
        const cases: [string, string, Role][] = [
          [actors.owner, ids[name], 'viewer'], // allowed
          [actors.viewer, ids[name], 'owner'], // 403
          [actors.outsider, ids[name], 'viewer'], // 404 non-member
          [actors.owner, RANDOM_UUID, 'viewer'], // 404 missing
        ]
        for (const [userId, id, min] of cases) {
          counted.reset()
          await outcome(load(counted.db, userId, id, min))
          expect(counted.count(), `${name} ${userId.slice(0, 8)} ${min}`).toBe(1)
        }
      })
    })
  }

  it('project-scoped loaders also report the owning projectId', async () => {
    for (const name of ['project', 'route', 'case', 'preset', 'version', 'deployment'] as const) {
      const loader = LOADERS.find((l) => l.name === name)!.load
      const v = (await loader(t.db, actors.owner, ids[name], 'viewer')) as { projectId: string }
      expect(v.projectId).toBe(ids.project)
    }
  })

  it('the version loader returns metadata only, never the snapshot or baked payload', async () => {
    const { entity } = await loadVersionForUser(t.db, actors.viewer, ids.version, 'viewer')
    expect(entity).not.toHaveProperty('snapshot')
    expect(entity).not.toHaveProperty('baked')
    expect(entity).toMatchObject({ id: ids.version, seq: 1, label: 'v1' })
  })

  it('a removed member loses access immediately', async () => {
    const u = await f.createUser()
    const m = await f.createMember({ workspaceId: ids.workspace, userId: u.id, role: 'editor' })
    expect((await loadProjectForUser(t.db, u.id, ids.project, 'editor')).role).toBe('editor')
    await t.db
      .delete(schema.workspaceMembers)
      .where((await import('drizzle-orm')).eq(schema.workspaceMembers.id, m.id))
    expect(await outcome(loadProjectForUser(t.db, u.id, ids.project, 'viewer'))).toMatchObject({
      status: 404,
    })
  })
})

describe('getMembership, requireRole, requireWorkspaceRole, createAccess', () => {
  it('getMembership returns the role, or null for non-members, unknown workspaces and bad ids', async () => {
    expect(await getMembership(t.db, actors.owner, ids.workspace)).toBe('owner')
    expect(await getMembership(t.db, actors.editor, ids.workspace)).toBe('editor')
    expect(await getMembership(t.db, actors.viewer, ids.workspace)).toBe('viewer')
    expect(await getMembership(t.db, actors.outsider, ids.workspace)).toBeNull()
    expect(await getMembership(t.db, actors.owner, RANDOM_UUID)).toBeNull()
    expect(await getMembership(t.db, 'not-a-uuid', ids.workspace)).toBeNull()
  })

  it('getMembership is one query; a bad id costs none', async () => {
    counted.reset()
    await getMembership(counted.db, actors.owner, ids.workspace)
    expect(counted.count()).toBe(1)
    await getMembership(counted.db, 'bad', ids.workspace)
    expect(counted.count()).toBe(1)
  })

  it('requireRole: null -> 404, too low -> 403, enough -> the role', () => {
    expect(() => requireRole(null, 'viewer')).toThrowError(HttpError)
    try {
      requireRole(null, 'viewer')
    } catch (e) {
      expect(e).toMatchObject({ status: 404, code: 'not_found' })
    }
    try {
      requireRole('viewer', 'editor')
    } catch (e) {
      expect(e).toMatchObject({ status: 403, code: 'forbidden' })
    }
    expect(requireRole('owner', 'editor')).toBe('owner')
    expect(requireRole('editor', 'editor')).toBe('editor')
  })

  it('requireWorkspaceRole is what endpoints addressed by a body workspaceId (projects.create) use', async () => {
    expect(await requireWorkspaceRole(t.db, actors.editor, ids.workspace, 'editor')).toBe('editor')
    expect(
      await outcome(requireWorkspaceRole(t.db, actors.viewer, ids.workspace, 'editor')),
    ).toEqual({
      ok: false,
      status: 403,
      code: 'forbidden',
    })
    expect(
      await outcome(requireWorkspaceRole(t.db, actors.outsider, ids.workspace, 'viewer')),
    ).toEqual({
      ok: false,
      status: 404,
      code: 'not_found',
    })
  })

  it('createAccess binds every loader to one Db', async () => {
    const access = createAccess(t.db)
    expect((await access.loadProjectForUser(actors.editor, ids.project, 'editor')).role).toBe(
      'editor',
    )
    expect(await access.getMembership(actors.viewer, ids.workspace)).toBe('viewer')
    expect(Object.keys(access).sort()).toEqual(
      [
        'getMembership',
        'loadCaseForUser',
        'loadDeploymentForUser',
        'loadPresetForUser',
        'loadProjectForUser',
        'loadRouteForUser',
        'loadVersionForUser',
        'loadWorkspaceForUser',
        'requireWorkspaceRole',
      ].sort(),
    )
  })

  it('error bodies do not distinguish "missing" from "not yours"', async () => {
    const missing = (await outcome(
      loadProjectForUser(t.db, actors.owner, RANDOM_UUID, 'viewer'),
    )) as {
      ok: false
    }
    const notYours = (await outcome(
      loadProjectForUser(t.db, actors.outsider, ids.project, 'viewer'),
    )) as {
      ok: false
    }
    expect(notYours).toEqual(missing)
  })
})

describe('permissions.ts: the role matrix is encoded once', () => {
  it('roleAtLeast follows viewer < editor < owner', () => {
    const table: [Role, Role, boolean][] = [
      ['viewer', 'viewer', true],
      ['viewer', 'editor', false],
      ['viewer', 'owner', false],
      ['editor', 'viewer', true],
      ['editor', 'editor', true],
      ['editor', 'owner', false],
      ['owner', 'viewer', true],
      ['owner', 'editor', true],
      ['owner', 'owner', true],
    ]
    for (const [role, min, expected] of table) expect(roleAtLeast(role, min)).toBe(expected)
  })

  it('AUTH_POLICY has exactly the contract auth levels, so a new level cannot be added without a policy', () => {
    expect(Object.keys(AUTH_POLICY).sort()).toEqual([...AUTH_LEVELS].sort())
  })

  it('every registry endpoint auth level is present in AUTH_POLICY', () => {
    const missing = registry.endpoints.filter((e) => !(e.auth in AUTH_POLICY)).map((e) => e.id)
    expect(missing).toEqual([])
    for (const e of registry.endpoints) expect(() => minRoleFor(e.auth)).not.toThrow()
  })

  it('minRoleFor rejects a level the policy does not know', () => {
    expect(() => minRoleFor('superuser' as never)).toThrow(/missing from AUTH_POLICY/)
  })

  it('maps levels to the documented minimum roles', () => {
    expect(minRoleFor('public')).toBeNull()
    expect(minRoleFor('session')).toBeNull()
    expect(minRoleFor('viewer')).toBe('viewer')
    expect(minRoleFor('editor')).toBe('editor')
    expect(minRoleFor('owner')).toBe('owner')
    expect(AUTH_POLICY.public.requiresSession).toBe(false)
    expect(AUTH_POLICY.session.requiresSession).toBe(true)
  })

  it('the registry follows API-CONTRACT 1.3: every GET needs at most viewer; role-gated writes need editor or owner', () => {
    const offenders: string[] = []
    for (const e of registry.endpoints) {
      const min = minRoleFor(e.auth)
      if (e.method === 'GET' && min !== null && min !== 'viewer')
        offenders.push(`${e.id}: GET needs ${min}`)
      if (e.method !== 'GET' && min === 'viewer')
        offenders.push(`${e.id}: ${e.method} only needs viewer`)
    }
    expect(offenders).toEqual([])
  })
})
