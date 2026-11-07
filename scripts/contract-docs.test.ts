import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs library without type declarations
import { compareContract, parseContractDoc, normalizeDocPath } from './contract-docs-lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const realDoc = readFileSync(`${root}docs/API-CONTRACT.md`, 'utf8')

type Summary = {
  id: string
  method: string
  path: string
  auth: string
  errors: { status: number; code: string }[]
  aliases?: string[]
}

const FIXTURE = `# Doc

## 2. Shared types

| id | Endpoint | Auth |
| --- | --- | --- |
| \`not.an.endpoint\` | \`GET /ignored\` | public |

## 3. Control-plane endpoints

### 3.1 Things

| \`id\` | Endpoint | Auth | Response | Errors |
| --- | --- | --- | --- | --- |
| \`things.get\` ⁺ | \`GET /things/:thingId\` | viewer of \`workspaceId\` | \`200 Thing\` | \`404 thing_gone\` · \`429\` |
| \`things.create\` | \`POST /things\` | **editor** | \`201 Thing\` | \`409 name_taken\` · \`422 validation_failed\` |
| \`things.health\` | \`GET /healthz\` and \`GET /api/v1/healthz\` | public | \`200\` | — |
| \`things.list\` | \`GET /things?workspaceId=<id>&limit&cursor\` | session | \`200\` | — |
| \`things.remove\` | \`DELETE /things/:thingId\` | owner, **or any member removing their own membership** | \`204\` | \`409 in_use\` |
| \`things.spec\` | \`GET /api/v1/openapi.json\` | public | \`200\` | — |

\`\`\`
| \`id\` | Endpoint | Auth | Errors |
| \`things.fenced\` | \`GET /fenced\` | public | — |
\`\`\`

## 4. Data plane

| id | Endpoint | Auth |
| --- | --- | --- |
| \`things.after\` | \`GET /after\` | public |
`

const REGISTRY: Summary[] = [
  {
    id: 'things.get',
    method: 'GET',
    path: '/things/:thingId',
    auth: 'viewer',
    errors: [{ status: 404, code: 'thing_gone' }],
  },
  {
    id: 'things.create',
    method: 'POST',
    path: '/things',
    auth: 'editor',
    errors: [{ status: 409, code: 'name_taken' }],
  },
  { id: 'things.health', method: 'GET', path: '/healthz', auth: 'public', errors: [] },
  { id: 'things.list', method: 'GET', path: '/things', auth: 'session', errors: [] },
  {
    id: 'things.remove',
    method: 'DELETE',
    path: '/things/:thingId',
    auth: 'owner',
    errors: [{ status: 409, code: 'in_use' }],
  },
  { id: 'things.spec', method: 'GET', path: '/openapi.json', auth: 'public', errors: [] },
]

const clone = (r: Summary[]): Summary[] => structuredClone(r)
const kinds = (issues: { id: string; kind: string }[]) =>
  issues.map((i) => `${i.kind}:${i.id}`).sort()

describe('parseContractDoc (fixture)', () => {
  const { endpoints, problems } = parseContractDoc(FIXTURE)
  const byId = Object.fromEntries(endpoints.map((e: { id: string }) => [e.id, e]))

  it('reads only section 3 tables and skips fenced code', () => {
    expect(endpoints.map((e: { id: string }) => e.id)).toEqual([
      'things.get',
      'things.create',
      'things.health',
      'things.list',
      'things.remove',
      'things.spec',
    ])
    expect(problems).toEqual([])
  })
  it('ignores the addition marker after the id', () => {
    expect(byId['things.get']).toBeDefined()
  })
  it('takes the first auth word ("viewer of `workspaceId`", "**editor**", "owner, or any member")', () => {
    expect(byId['things.get'].auth).toBe('viewer')
    expect(byId['things.create'].auth).toBe('editor')
    expect(byId['things.remove'].auth).toBe('owner')
  })
  it('drops query strings and the /api/v1 prefix, and collapses duplicate paths into no alias', () => {
    expect(byId['things.list'].path).toBe('/things')
    expect(byId['things.spec'].path).toBe('/openapi.json')
    expect(byId['things.health'].path).toBe('/healthz')
    expect(byId['things.health'].aliases).toEqual([])
  })
  it('lists a genuinely different second route as an alias', () => {
    const doc = FIXTURE.replace(
      '`GET /healthz` and `GET /api/v1/healthz`',
      '`GET /healthz` and `GET /api/v1/status`',
    )
    const e = parseContractDoc(doc).endpoints.find((x: { id: string }) => x.id === 'things.health')
    expect(e.aliases).toEqual(['GET /status'])
  })
  it('extracts `NNN code` pairs and ignores a bare `429`', () => {
    expect(byId['things.get'].errors).toEqual([{ status: 404, code: 'thing_gone' }])
    expect(byId['things.create'].errors).toEqual([
      { status: 409, code: 'name_taken' },
      { status: 422, code: 'validation_failed' },
    ])
  })
  it('reports a row whose cell count differs from the header', () => {
    const bad = FIXTURE.replace(
      '| `things.create` | `POST /things` | **editor** | `201 Thing` |',
      '| `things.create` | `POST /things` | **editor** |',
    )
    const r = parseContractDoc(bad)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toMatchObject({ id: 'things.create', kind: 'malformed_row' })
    // Still readable: leading columns plus the LAST cell as Errors.
    expect(r.endpoints.find((e: { id: string }) => e.id === 'things.create')).toMatchObject({
      auth: 'editor',
    })
  })
  it('normalises doc paths', () => {
    expect(normalizeDocPath('/api/v1/openapi.json')).toBe('/openapi.json')
    expect(normalizeDocPath('/projects?a=1')).toBe('/projects')
    expect(normalizeDocPath('/api/v1')).toBe('/')
  })
})

describe('compareContract (both directions, fixture docs)', () => {
  const doc = parseContractDoc(FIXTURE).endpoints

  it('reports nothing when doc and registry agree (implicit codes ignored on both sides)', () => {
    expect(compareContract(doc, REGISTRY)).toEqual([])
    const withImplicit = clone(REGISTRY)
    withImplicit[1]!.errors.push(
      { status: 422, code: 'validation_failed' },
      { status: 401, code: 'unauthenticated' },
    )
    expect(compareContract(doc, withImplicit)).toEqual([])
  })
  it('names the id when a registry entry has no doc row', () => {
    const r = [
      ...REGISTRY,
      { id: 'things.extra', method: 'GET', path: '/extra', auth: 'public', errors: [] },
    ]
    const issues = compareContract(doc, r)
    expect(kinds(issues)).toEqual(['missing_in_docs:things.extra'])
    expect(issues[0].message).toContain('things.extra')
  })
  it('names the id when a doc row has no registry entry', () => {
    const issues = compareContract(
      doc,
      REGISTRY.filter((e) => e.id !== 'things.list'),
    )
    expect(kinds(issues)).toEqual(['missing_in_registry:things.list'])
    expect(issues[0].message).toContain('things.list')
  })
  it('detects method, path and auth differences', () => {
    const r = clone(REGISTRY)
    r[0]!.method = 'POST'
    r[1]!.path = '/thingz'
    r[3]!.auth = 'viewer'
    expect(kinds(compareContract(doc, r))).toEqual([
      'auth_mismatch:things.list',
      'method_mismatch:things.get',
      'path_mismatch:things.create',
    ])
  })
  it('detects errors present on only one side', () => {
    const r = clone(REGISTRY)
    r[0]!.errors = [] // doc lists 404 thing_gone
    r[2]!.errors = [{ status: 409, code: 'only_in_registry' }]
    expect(kinds(compareContract(doc, r))).toEqual([
      'error_missing_in_docs:things.health',
      'error_missing_in_registry:things.get',
    ])
  })
  it('detects alias differences', () => {
    const r = clone(REGISTRY)
    r[2]!.aliases = ['/status']
    expect(kinds(compareContract(doc, r))).toEqual(['alias_mismatch:things.health'])
  })
  it('treats a registry path written with the /api/v1 prefix as equal', () => {
    const r = clone(REGISTRY)
    r[5]!.path = '/api/v1/openapi.json'
    expect(compareContract(doc, r)).toEqual([])
  })
})

describe('the real docs/API-CONTRACT.md', () => {
  const { endpoints, problems } = parseContractDoc(realDoc)
  // Independent count: every first-column `area.operation` id on a table row of section 3.
  const section3 = realDoc.slice(
    realDoc.indexOf('## 3. Control-plane'),
    realDoc.indexOf('## 4. Data plane'),
  )
  const expectedIds = [...section3.matchAll(/^\| `([a-z]+\.[A-Za-z]+)`/gm)].map(
    (m) => m[1] as string,
  )

  it('extracts every endpoint id in section 3', () => {
    expect(endpoints.map((e: { id: string }) => e.id).sort()).toEqual([...expectedIds].sort())
    expect(new Set(expectedIds).size).toBe(expectedIds.length)
    // Printed in the unit report; the number is a fact about the document, not a target.
    console.log(`endpoints extracted from docs/API-CONTRACT.md section 3: ${endpoints.length}`)
    expect(endpoints.length).toBeGreaterThanOrEqual(50)
  })
  it('gives every endpoint a method, a path and a known auth level', () => {
    for (const e of endpoints) {
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], e.id).toContain(e.method)
      expect(e.path.startsWith('/'), e.id).toBe(true)
      expect(['public', 'session', 'viewer', 'editor', 'owner'], e.id).toContain(e.auth)
    }
  })
  it('reads representative rows correctly', () => {
    const get = (id: string) => endpoints.find((e: { id: string }) => e.id === id)
    expect(get('system.healthz')).toMatchObject({
      method: 'GET',
      path: '/healthz',
      auth: 'public',
      aliases: [],
    })
    expect(get('system.openapi')).toMatchObject({ path: '/openapi.json' })
    expect(get('projects.list')).toMatchObject({ method: 'GET', path: '/projects', auth: 'viewer' })
    expect(get('members.remove')).toMatchObject({ method: 'DELETE', auth: 'owner' })
    expect(get('versions.diff')).toMatchObject({
      path: '/versions/:fromId/diff/:toId',
      auth: 'viewer',
    })
    expect(get('auth.register').errors).toEqual(
      expect.arrayContaining([
        { status: 403, code: 'signup_disabled' },
        { status: 409, code: 'email_taken' },
      ]),
    )
  })
  it('round-trips: a registry built from the parsed doc compares clean, and one mutation names its id', () => {
    const summary: Summary[] = endpoints.map((e: Summary) => ({
      id: e.id,
      method: e.method,
      path: e.path,
      auth: e.auth,
      errors: e.errors,
      aliases: e.aliases ?? [],
    }))
    expect(compareContract(endpoints, summary)).toEqual([])
    const mutated = clone(summary)
    mutated[7]!.auth = mutated[7]!.auth === 'owner' ? 'viewer' : 'owner'
    const issues = compareContract(endpoints, mutated)
    expect(issues).toHaveLength(1)
    expect(issues[0].id).toBe(summary[7]!.id)
  })
  it('flags the one known malformed row (projects.import has no Response cell) instead of hiding it', () => {
    // This documents a real defect in API-CONTRACT.md section 3.11 found by the checker. When the
    // doc row is fixed this list becomes empty; the assertion then needs to drop the allowance.
    for (const p of problems) expect(p.id).toBe('projects.import')
    for (const p of problems) expect(p.kind).toBe('malformed_row')
  })
})

describe('pnpm contract:docs CLI (no registry defined yet)', () => {
  const hasRegistry = /export const registry\b/.test(
    readFileSync(`${root}packages/api-contract/src/index.ts`, 'utf8'),
  )
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [`${root}scripts/contract-docs.mjs`, ...args], {
      encoding: 'utf8',
      cwd: root,
    })

  it.skipIf(hasRegistry)(
    'exits 0 and says FND-07 has not defined one when run without --check',
    () => {
      const r = run()
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('FND-07')
    },
  )
  it.skipIf(hasRegistry)(
    'fails closed (exit 1) under --check when there is no registry, and says why',
    () => {
      const r = run('--check')
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('FND-07')
    },
  )
})
