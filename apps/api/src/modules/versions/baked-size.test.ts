// RUN-14: total baked-size cap per version (ADR 0017, ADR 0021).
import type { MockNode, MockSchema } from '@mockbench/schema-core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projects, versions } from '../../db/schema'
import { testApp } from '../../testing'
import type { TestApp } from '../../testing'
import { publishVersion } from './service'
import {
  BakedTooLargeError,
  MAX_BAKED_BYTES,
  PublishInvalidError,
  buildVersionPayload,
} from './snapshot'

let t: TestApp
beforeAll(async () => {
  t = await testApp()
})
afterAll(() => t.drop())

/** A case whose baked body is exactly `"<n x chars>"`, i.e. n + 2 bytes. */
const sized = (n: number): MockSchema => ({
  version: 1,
  components: {},
  root: { type: 'string', fixed: 'x'.repeat(n) } as MockNode,
})
const invalid = {
  version: 1,
  components: {},
  root: { type: 'nope' },
} as unknown as MockSchema

type Mode = 'deterministic' | 'seeded' | 'random'

/** One route per entry, one case each, named c0, c1, ... */
async function projectOf(
  sizes: (number | 'invalid')[],
  mode: Mode = 'deterministic',
  workspaceId?: string,
) {
  const project = await t.f.createProject({
    ...(workspaceId ? { workspaceId } : {}),
    settings: { indexing: 'path', mode, cors: '*', defaultDelayMs: 0 },
  })
  const cases: { routeId: string; caseId: string }[] = []
  for (const [i, size] of sizes.entries()) {
    const route = await t.f.createRoute({
      projectId: project.id,
      path: `/r${i}`,
      withDefaultCase: false,
    })
    const c = await t.f.createCase({
      routeId: route.id,
      name: `c${i}`,
      schema: size === 'invalid' ? invalid : sized(size),
      isDefault: true,
    })
    cases.push({ routeId: route.id, caseId: c.id })
  }
  return { project, cases }
}

async function bakeError(projectId: string, maxBakedBytes: number): Promise<BakedTooLargeError> {
  const err = await buildVersionPayload(t.db, projectId, { maxBakedBytes }).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(BakedTooLargeError)
  return err as BakedTooLargeError
}

describe('buildVersionPayload: total baked-size cap', () => {
  it('the limit is 64 MiB', () => {
    expect(MAX_BAKED_BYTES).toBe(67_108_864)
  })

  it('at the cap it bakes, one byte over it does not; bakedBytes is the stored JSON length', async () => {
    const { project } = await projectOf([1000, 2000, 3000])
    const ok = await buildVersionPayload(t.db, project.id)
    expect(ok.bakedBytes).toBe(Buffer.byteLength(ok.baked!, 'utf8'))
    const atCap = await buildVersionPayload(t.db, project.id, { maxBakedBytes: ok.bakedBytes })
    expect(atCap.bakedBytes).toBe(ok.bakedBytes)
    const err = await bakeError(project.id, ok.bakedBytes - 1)
    expect(err.totalBytes).toBe(ok.bakedBytes)
  })

  it('over the cap: the 10 largest cases, largest first, with route and case identity', async () => {
    const sizes = [500, 9000, 100, 7000, 3000, 8000, 50, 6000, 2000, 4000, 1000, 5000]
    const { project, cases } = await projectOf(sizes)
    const err = await bakeError(project.id, 20_000)
    expect(err.limitBytes).toBe(20_000)
    expect(err.largest).toHaveLength(10)
    expect(err.largest.map((c) => c.bytes)).toEqual(
      [9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000, 500].map((n) => n + 2),
    )
    expect(err.largest[0]).toEqual({
      routeId: cases[1]!.routeId,
      method: 'GET',
      path: '/r1',
      caseId: cases[1]!.caseId,
      caseName: 'c1',
      bytes: 9002,
    })
    // The total keeps being measured past the cap.
    const full = await buildVersionPayload(t.db, project.id)
    expect(err.totalBytes).toBe(full.bakedBytes)
  })

  it('memory stays bounded: bodies held never exceed the cap plus one case', async () => {
    const { project } = await projectOf(Array.from({ length: 40 }, () => 1000))
    const err = await bakeError(project.id, 5000)
    expect(err.totalBytes).toBeGreaterThan(40_000)
    expect(err.retainedBytes).toBeLessThanOrEqual(5000 + 1002)
  })

  it('random mode bakes nothing, so the cap does not apply', async () => {
    const { project } = await projectOf([5000, 5000], 'random')
    const ok = await buildVersionPayload(t.db, project.id, { maxBakedBytes: 100 })
    expect(ok).toMatchObject({ baked: null, bakedBytes: 0 })
  })

  it('an invalid case wins over the cap: publish_invalid', async () => {
    const { project } = await projectOf([5000, 'invalid', 5000])
    const err = await buildVersionPayload(t.db, project.id, { maxBakedBytes: 100 }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(PublishInvalidError)
  })

  it('publishVersion over the cap: 422 baked_too_large, no version row, seq unchanged', async () => {
    const { project } = await projectOf([3000, 3000])
    const err = await publishVersion(t.db, project.id, null, {}, { maxBakedBytes: 1000 }).catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ status: 422, code: 'baked_too_large' })
    expect(
      await t.db.select().from(versions).where(eq(versions.projectId, project.id)),
    ).toHaveLength(0)
    const [p] = await t.db.select().from(projects).where(eq(projects.id, project.id))
    expect(p!.versionSeq).toBe(0)
  })
})

describe('versions.publish at the real 64 MiB cap', () => {
  it('returns 422 baked_too_large with contract-shaped details; nothing is stored', async () => {
    const ws = await t.f.createWorkspace()
    const m = await t.f.createMember({ workspaceId: ws.id, role: 'editor' })
    const editor = await t.session(m.userId)
    // 5 cases of 14 MiB = 70 MiB; the 4th is slightly bigger so the order is checked.
    const MiB = 1024 * 1024
    const { project, cases } = await projectOf(
      [14 * MiB, 14 * MiB, 14 * MiB, 14 * MiB + 10, 14 * MiB],
      'deterministic',
      ws.id,
    )
    const res = await t.as(editor).post(`/api/v1/projects/${project.id}/versions`).send({})
    expect(res.status).toBe(422)
    t.assertContract('versions.publish', res)
    expect(res.body.error).toBe('baked_too_large')
    expect(res.body.message).toBe(
      'The baked responses total 70.0 MiB; the limit is 64 MiB. Shrink the largest cases or switch the project to random mode.',
    )
    expect(res.body.details).toHaveLength(5)
    expect(res.body.details[0]).toMatchObject({ caseId: cases[3]!.caseId, bytes: 14 * MiB + 12 })
    expect(
      await t.db.select().from(versions).where(eq(versions.projectId, project.id)),
    ).toHaveLength(0)
  }, 120_000)
})
