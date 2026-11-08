import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import SwaggerParser from '@apidevtools/swagger-parser'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  EMPTY_SCHEMA_ENVELOPE,
  MOCK_ERROR_CODES,
  MOCK_HEADERS,
  MockErrorBody,
  SELECTOR_ORDER,
  defineEndpoint,
  defineRegistry,
  endpoints,
  exampleAuthState,
  exampleEnvelope,
  registry,
  toValidationIssues,
} from '../src/index'
import type { AreaHandlers, EndpointDef } from '../src/index'
import { generateOpenApi, toOpenApiPath } from '../src/openapi'
// @ts-expect-error plain .mjs script without type declarations
import { compareContract, parseContractDoc } from '../../../scripts/contract-docs-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const all = registry.endpoints as readonly EndpointDef[]
const get = (id: string) => registry.get(id) as EndpointDef

const ID = '0190a1b2-c3d4-7e5f-8a6b-000000000001'
const issues = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value)
  return r.success ? [] : toValidationIssues(r.error)
}

describe('registry coverage', () => {
  it('defines all 53 control-plane endpoints', () => {
    expect(all).toHaveLength(53)
  })

  it('maps every endpoint under its area (the id prefix) in `endpoints`', () => {
    const seen: string[] = []
    for (const [area, group] of Object.entries(endpoints)) {
      for (const [op, e] of Object.entries(group as Record<string, EndpointDef>)) {
        expect(e.id).toBe(`${area}.${op}`)
        seen.push(e.id)
      }
    }
    expect(seen.sort()).toEqual(all.map((e) => e.id).sort())
  })

  it('has unique ids and every endpoint carries a tag equal to its area', () => {
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length)
    for (const e of all) expect(e.tags).toContain(e.id.split('.')[0])
  })
})

describe('examples', () => {
  it('every request example parses with its own body schema', () => {
    for (const e of all) {
      if (e.body) {
        expect(e.example.request, `${e.id} needs a request example`).toBeDefined()
        const r = e.body.safeParse(e.example.request)
        expect(r.success, `${e.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true)
      } else {
        expect(e.example.request, `${e.id} has no body so no request example`).toBeUndefined()
      }
    }
  })

  it('every response example parses with its own success schema', () => {
    for (const e of all) {
      const ok = Object.entries(e.responses)
        .filter(([s]) => Number(s) >= 200 && Number(s) < 300)
        .map(([, schema]) => schema)
      const withBody = ok.filter((s): s is z.ZodType => s !== null)
      if (withBody.length === 0) {
        expect(e.example.response, `${e.id} is 204 so has no response example`).toBeUndefined()
        continue
      }
      expect(e.example.response, `${e.id} needs a response example`).toBeDefined()
      const r = withBody[0]!.safeParse(e.example.response)
      expect(r.success, `${e.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true)
    }
  })

  it('the empty-object envelope and the example envelope validate as MockSchema', () => {
    const body = get('cases.create').body!
    expect(
      body.safeParse({ name: 'X', statusCode: 200, schema: EMPTY_SCHEMA_ENVELOPE }).success,
    ).toBe(true)
    expect(body.safeParse({ name: 'X', statusCode: 200, schema: exampleEnvelope }).success).toBe(
      true,
    )
  })
})

describe('docs/API-CONTRACT.md drift check', () => {
  const doc = parseContractDoc(readFileSync(resolve(root, 'docs/API-CONTRACT.md'), 'utf8'))
  const summary = all.map((e) => ({
    id: e.id,
    method: e.method,
    path: e.path,
    auth: e.auth,
    errors: e.errors,
    aliases: e.aliases ?? [],
  }))

  it('the doc parses cleanly: 53 endpoint rows and no malformed rows', () => {
    expect(doc.problems).toEqual([])
    expect(doc.endpoints).toHaveLength(53)
  })

  it('every id, method, path and auth level and every error code agree in both directions', () => {
    expect(compareContract(doc.endpoints, summary)).toEqual([])
  })

  it('`pnpm contract:docs --check` exits 0', () => {
    const r = spawnSync(process.execPath, ['scripts/contract-docs.mjs', '--check'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 90_000,
    })
    expect(`${r.stdout}${r.stderr}`).toContain('OK')
    expect(r.status).toBe(0)
  })
})

describe('request bodies are strict', () => {
  it('rejects unknown keys with the unrecognized_keys code and the key in the path', () => {
    const body = get('auth.register').body!
    const out = issues(body, { email: 'a@b.test', password: 'password1', name: 'A', extra: 1 })
    expect(out).toEqual([expect.objectContaining({ path: ['extra'], code: 'unrecognized_keys' })])
  })
  it('validates required fields and formats (email, password length)', () => {
    const body = get('auth.register').body!
    expect(
      body.safeParse({ email: 'not-an-email', password: 'password1', name: 'A' }).success,
    ).toBe(false)
    expect(body.safeParse({ email: 'a@b.test', password: 'short', name: 'A' }).success).toBe(false)
    expect(
      body.safeParse({ email: 'a@b.test', password: 'x'.repeat(129), name: 'A' }).success,
    ).toBe(false)
    expect(body.safeParse({ email: 'a@b.test', password: 'password1', name: 'A' }).success).toBe(
      true,
    )
  })
  it('login does not enforce the new-password length policy', () => {
    expect(get('auth.login').body!.safeParse({ email: 'a@b.test', password: 'x' }).success).toBe(
      true,
    )
  })
})

describe('PATCH semantics', () => {
  const update = get('projects.update').body!

  it('projects.update rejects slug with the code read_only', () => {
    expect(issues(update, { slug: 'new-slug' })).toEqual([
      expect.objectContaining({ path: ['slug'], code: 'read_only' }),
    ])
    expect(issues(update, { workspaceId: ID })).toEqual([
      expect.objectContaining({ path: ['workspaceId'], code: 'read_only' }),
    ])
  })
  it('accepts {} (a valid no-op)', () => {
    expect(update.safeParse({}).success).toBe(true)
  })
  it('accepts description: null (nullable) but rejects name: null', () => {
    expect(update.safeParse({ description: null }).success).toBe(true)
    expect(update.safeParse({ name: null }).success).toBe(false)
    expect(update.safeParse({ settings: null }).success).toBe(false)
    expect(update.safeParse({ components: null }).success).toBe(false)
  })
  it('rejects unknown keys as unrecognized_keys (not read_only)', () => {
    expect(issues(update, { colour: 'red' })).toEqual([
      expect.objectContaining({ path: ['colour'], code: 'unrecognized_keys' }),
    ])
  })
  it('accepts a partial settings object and rejects an unknown or invalid setting', () => {
    expect(update.safeParse({ settings: { mode: 'seeded' } }).success).toBe(true)
    expect(update.safeParse({ settings: { mode: 'chaos' } }).success).toBe(false)
    expect(update.safeParse({ settings: { defaultDelayMs: 10_001 } }).success).toBe(false)
    expect(update.safeParse({ settings: { nope: 1 } }).success).toBe(false)
  })
  it('workspaces.update rejects slug (read_only); cases.update rejects isDefault (read_only)', () => {
    expect(issues(get('workspaces.update').body!, { slug: 'x-y' })).toEqual([
      expect.objectContaining({ path: ['slug'], code: 'read_only' }),
    ])
    expect(issues(get('cases.update').body!, { isDefault: true })).toEqual([
      expect.objectContaining({ path: ['isDefault'], code: 'read_only' }),
    ])
  })
  it('cases.update accepts delayMs null (inherit) and rejects statusCode null', () => {
    const body = get('cases.update').body!
    expect(body.safeParse({ delayMs: null }).success).toBe(true)
    expect(body.safeParse({ statusCode: null }).success).toBe(false)
    expect(body.safeParse({}).success).toBe(true)
  })
  it('routes.update accepts description null but not method null', () => {
    const body = get('routes.update').body!
    expect(body.safeParse({ description: null }).success).toBe(true)
    expect(body.safeParse({ method: null }).success).toBe(false)
  })
  it('read-only keys are documented as readOnly in the OpenAPI body schema', () => {
    const doc = generateOpenApi(registry) as never as {
      paths: Record<
        string,
        Record<string, { requestBody: { content: Record<string, { schema: unknown }> } }>
      >
    }
    const op = doc.paths['/projects/{projectId}']?.patch
    expect(JSON.stringify(op?.requestBody)).toContain('"readOnly":true')
  })
})

describe('field rules in bodies', () => {
  it('routes.create enforces the path grammar and reports the grammar code at path', () => {
    const body = get('routes.create').body!
    expect(issues(body, { method: 'GET', path: '/users/' })).toEqual([
      expect.objectContaining({ path: ['path'], code: 'trailing_slash' }),
    ])
    expect(body.safeParse({ method: 'GET', path: '/users/:id' }).success).toBe(true)
    expect(body.safeParse({ method: 'OPTIONS', path: '/x' }).success).toBe(false)
  })
  it('cases.create enforces the status list, delay range, headers and name', () => {
    const body = get('cases.create').body!
    const ok = { name: 'Not found', statusCode: 404 }
    expect(body.safeParse(ok).success).toBe(true)
    expect(body.safeParse({ ...ok, statusCode: 418 }).success).toBe(false)
    expect(body.safeParse({ ...ok, delayMs: 10_001 }).success).toBe(false)
    expect(body.safeParse({ ...ok, delayMs: 0 }).success).toBe(true)
    expect(body.safeParse({ ...ok, delayMs: null }).success).toBe(true)
    expect(issues(body, { ...ok, headers: { 'X-Mock-Case': 'x' } })).toEqual([
      expect.objectContaining({ path: ['headers', 'X-Mock-Case'], code: 'reserved_header' }),
    ])
    expect(body.safeParse({ ...ok, name: '   ' }).success).toBe(false)
  })
  it('projects.create requires workspaceId, name and a well-formed slug (reserved words pass: slug_reserved is a handler error)', () => {
    const body = get('projects.create').body!
    expect(body.safeParse({ workspaceId: ID, name: 'Billing', slug: 'billing-api' }).success).toBe(
      true,
    )
    expect(body.safeParse({ workspaceId: ID, name: 'Billing', slug: 'Billing' }).success).toBe(
      false,
    )
    expect(body.safeParse({ workspaceId: ID, name: 'Billing', slug: 'api' }).success).toBe(true)
    expect(body.safeParse({ name: 'Billing', slug: 'billing-api' }).success).toBe(false)
  })
  it('presets.create validates rules with the schema-core rule schema and its 500-rule cap', () => {
    const body = get('presets.create').body!
    const rule = { match: { key: 'role' }, values: ['a', 'b'] }
    expect(body.safeParse({ name: 'P', rules: [rule] }).success).toBe(true)
    expect(body.safeParse({ name: 'P', rules: [{ match: { key: 'role' } }] }).success).toBe(false)
    expect(
      body.safeParse({ name: 'P', rules: Array.from({ length: 501 }, () => rule) }).success,
    ).toBe(false)
  })
  it('schema.infer accepts any JSON value as sample, including null, but requires the key', () => {
    const body = get('schema.infer').body!
    for (const sample of [null, 0, 'x', [], { a: 1 }]) {
      expect(body.safeParse({ sample }).success).toBe(true)
    }
    expect(body.safeParse({}).success).toBe(false)
  })
  it('versions.publish limits the label to 1-80 characters', () => {
    const body = get('versions.publish').body!
    expect(body.safeParse({}).success).toBe(true)
    expect(body.safeParse({ label: 'x'.repeat(80) }).success).toBe(true)
    expect(body.safeParse({ label: 'x'.repeat(81) }).success).toBe(false)
    expect(body.safeParse({ label: '   ' }).success).toBe(false)
  })
})

describe('query schemas', () => {
  it('projects.list requires workspaceId and defaults limit to 50', () => {
    const q = get('projects.list').query!
    expect(q.safeParse({}).success).toBe(false)
    expect(q.parse({ workspaceId: ID })).toMatchObject({ limit: 50 })
    expect(q.safeParse({ workspaceId: ID, limit: '201' }).success).toBe(false)
    expect(q.safeParse({ workspaceId: ID, limit: '0' }).success).toBe(false)
  })
  it('requests.list takes the documented filters', () => {
    const q = get('requests.list').query!
    expect(
      q.safeParse({
        limit: '25',
        status: '4xx',
        method: 'POST',
        path: 'invoices',
        since: '2026-11-05T08:30:00.000Z',
        mockError: 'true',
      }).success,
    ).toBe(true)
    expect(q.safeParse({ status: '404' }).success).toBe(true)
    expect(q.safeParse({ status: '999' }).success).toBe(false)
    expect(q.safeParse({ mockError: 'yes' }).success).toBe(false)
    expect(q.safeParse({ unknown: 1 }).success).toBe(false)
  })
})

describe('registry uses the canonical path normalisation for collisions', () => {
  const mk = (id: string, path: string) =>
    defineEndpoint({
      id,
      method: 'GET',
      path,
      auth: 'public',
      params: z.strictObject(
        Object.fromEntries([...path.matchAll(/:(\w+)/g)].map((m) => [m[1]!, z.string()])),
      ),
      responses: { 200: z.strictObject({}) },
      errors: [],
      example: { response: {} },
      tags: ['t'],
    })
  it('treats /Users/:id and /users/:userId as the same route', () => {
    expect(() => defineRegistry([mk('t.a', '/Users/:id'), mk('t.b', '/users/:userId')])).toThrow(
      /both claim/,
    )
  })
})

describe('data-plane constants', () => {
  it('names the mock headers and the selector order from API-CONTRACT 4', () => {
    expect(MOCK_HEADERS).toEqual({
      version: 'X-Mock-Version',
      route: 'X-Mock-Route',
      case: 'X-Mock-Case',
      error: 'X-Mock-Error',
      status: 'X-Mock-Status',
    })
    expect(SELECTOR_ORDER.map((s) => `${s.source}:${s.name}`)).toEqual([
      'header:X-Mock-Case',
      'query:__case',
      'header:X-Mock-Status',
      'default:null',
    ])
  })
  it('MockErrorBody accepts each documented error and rejects missing extra fields', () => {
    const base = { message: 'm', hint: 'h' }
    expect(MOCK_ERROR_CODES).toHaveLength(6)
    for (const body of [
      { error: 'project_not_found', slug: 's', ...base },
      { error: 'project_not_published', slug: 's', ...base },
      { error: 'route_not_found', routes: [{ method: 'GET', path: '/x' }], ...base },
      {
        error: 'case_not_found',
        cases: [{ name: 'OK', statusCode: 200, isDefault: true }],
        ...base,
      },
      { error: 'rate_limited', ...base },
      { error: 'mock_internal_error', ...base },
    ]) {
      expect(MockErrorBody.safeParse(body).success, JSON.stringify(body)).toBe(true)
    }
    expect(MockErrorBody.safeParse({ error: 'route_not_found', ...base }).success).toBe(false)
    expect(MockErrorBody.safeParse({ error: 'project_not_found', ...base }).success).toBe(false)
  })
})

describe('OpenAPI document for the real registry', () => {
  const doc = generateOpenApi(registry) as never as {
    openapi: string
    paths: Record<string, Record<string, { operationId: string }>>
    components: { schemas: Record<string, unknown> }
  }

  it('validates as OpenAPI 3.1', async () => {
    expect(doc.openapi).toBe('3.1.0')
    await expect(SwaggerParser.validate(structuredClone(doc) as never)).resolves.toBeDefined()
  })
  it('contains every control-plane path and every operation id, and no /mock path', () => {
    const wanted = new Set(all.map((e) => toOpenApiPath(e.path)))
    expect(new Set(Object.keys(doc.paths))).toEqual(wanted)
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId))
    expect(ops.sort()).toEqual(all.map((e) => e.id).sort())
    expect(Object.keys(doc.paths).some((p) => p.includes('/mock'))).toBe(false)
  })
  it('hoists the main resources into components', () => {
    for (const name of [
      'ErrorEnvelope',
      'Project',
      'Route',
      'ResponseCase',
      'Version',
      'VersionDiff',
    ]) {
      expect(doc.components.schemas[name], name).toBeDefined()
    }
  })
})

describe('handler typing by area (compile-time)', () => {
  it('an auth module can bind auth endpoints only', () => {
    type AuthHandlers = AreaHandlers<typeof registry, 'auth'>
    const ok: AuthHandlers = {
      'auth.me': async () => ({ status: 200, body: exampleAuthState }),
    }
    const bad: AuthHandlers = {
      // @ts-expect-error projects.list is not an auth endpoint
      'projects.list': async () => ({ status: 200, body: { items: [], nextCursor: null } }),
    }
    expect(Object.keys(ok)).toEqual(['auth.me'])
    expect(Object.keys(bad)).toEqual(['projects.list'])
  })
})
