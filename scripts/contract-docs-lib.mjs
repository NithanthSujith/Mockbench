// Pure logic of `pnpm contract:docs --check` (FND-06): parse the endpoint tables of
// docs/API-CONTRACT.md section 3 and compare them with a registry summary, in both directions.
// No file or process access here, so it is unit-tested directly (scripts/contract-docs.test.ts).
//
// Defined normalisation of the prose tables (the doc is written for humans, so the checker is tolerant):
//   - Only tables under the heading "## 3. ..." up to the next "## " heading are read; fenced code is skipped.
//   - A table is an endpoint table when its header has columns `id`, `Endpoint` and `Auth`.
//   - id        : first `backticked` token that looks like `area.operation` (a trailing marker such as the
//                 addition mark is ignored).
//   - Endpoint  : every backticked `METHOD /path`. Query strings are dropped and a leading `/api/v1`
//                 is stripped (registry paths are relative to the /api/v1 base). The FIRST one is the
//                 primary route; any further ones that differ are aliases.
//   - Auth      : markdown stripped, then the first word among public|session|viewer|editor|owner
//                 ("viewer of `workspaceId`" -> viewer; "owner, or any member removing their own
//                 membership" -> owner).
//   - Errors    : every backticked `NNN snake_code`. Codes that are implicit for every endpoint
//                 (global codes and the auth legend's unauthenticated/forbidden/not_found) are ignored
//                 on BOTH sides when comparing. A bare `429` is not a code and is ignored.
//   - A row whose cell count differs from its header is reported as a `malformed_row` problem; the
//     leading columns (id, Endpoint, Auth) are still read, and Errors is taken from the LAST cell.

export const AUTH_WORDS = ['public', 'session', 'viewer', 'editor', 'owner']
export const IMPLICIT_CODES = new Set([
  'invalid_json',
  'csrf_rejected',
  'payload_too_large',
  'unsupported_media_type',
  'validation_failed',
  'rate_limited',
  'internal_error',
  'not_implemented',
  'unauthenticated',
  'forbidden',
  'not_found',
])

const BASE = '/api/v1'

export function normalizeDocPath(raw) {
  let p = raw.split('?')[0]
  if (p === BASE) return '/'
  if (p.startsWith(`${BASE}/`)) p = p.slice(BASE.length)
  return p
}

function splitRow(line) {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  // Split on unescaped pipes that are not inside backticks.
  const cells = []
  let cur = ''
  let inCode = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '`') {
      inCode = !inCode
      cur += ch
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

const stripMd = (s) => s.replace(/[`*_]/g, '')

export function parseAuth(cell) {
  const m = stripMd(cell).match(/\b(public|session|viewer|editor|owner)\b/)
  return m ? m[1] : null
}

export function parseEndpointCell(cell) {
  const found = [...cell.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/[^\s`]*)`/g)].map((m) => ({
    method: m[1],
    path: normalizeDocPath(m[2]),
  }))
  return found
}

export function parseErrorsCell(cell) {
  return [...cell.matchAll(/`(\d{3}) ([a-z][a-z0-9_]*)`/g)].map((m) => ({
    status: Number(m[1]),
    code: m[2],
  }))
}

/**
 * @param {string} markdown contents of docs/API-CONTRACT.md
 * @returns {{ endpoints: Array<{id:string,method:string,path:string,auth:string|null,aliases:string[],errors:{status:number,code:string}[],line:number}>, problems: Array<{id:string|null,kind:string,message:string,line:number}> }}
 */
export function parseContractDoc(markdown) {
  const lines = markdown.split(/\r?\n/)
  const endpoints = []
  const problems = []
  let inSection = false
  let inFence = false
  let header = null // {idx:{id,endpoint,auth,errors}, count}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^```/.test(line.trim())) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^## /.test(line)) {
      inSection = /^## 3\./.test(line)
      header = null
      continue
    }
    if (!inSection) continue
    if (!line.trim().startsWith('|')) {
      header = null
      continue
    }
    const cells = splitRow(line)
    if (/^:?-{3,}:?$/.test(cells[0] ?? '')) continue // separator row
    const names = cells.map((c) => stripMd(c).trim().toLowerCase())
    if (names[0] === 'id' && names.includes('endpoint') && names.includes('auth')) {
      header = {
        idx: {
          id: 0,
          endpoint: names.indexOf('endpoint'),
          auth: names.indexOf('auth'),
          errors: names.indexOf('errors'),
        },
        count: cells.length,
      }
      continue
    }
    if (!header) continue
    const idMatch = (cells[header.idx.id] ?? '').match(
      /`([a-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*)`/,
    )
    if (!idMatch) {
      problems.push({
        id: null,
        kind: 'malformed_row',
        message: `row has no endpoint id: ${line.slice(0, 80)}`,
        line: i + 1,
      })
      continue
    }
    const id = idMatch[1]
    if (cells.length !== header.count) {
      problems.push({
        id,
        kind: 'malformed_row',
        message: `row has ${cells.length} cells but its table header has ${header.count}`,
        line: i + 1,
      })
    }
    const routes = parseEndpointCell(cells[header.idx.endpoint] ?? '')
    if (routes.length === 0) {
      problems.push({
        id,
        kind: 'malformed_row',
        message: 'Endpoint cell has no `METHOD /path`',
        line: i + 1,
      })
      continue
    }
    const [primary, ...rest] = routes
    const auth = parseAuth(cells[header.idx.auth] ?? '')
    if (!auth)
      problems.push({
        id,
        kind: 'malformed_row',
        message: 'Auth cell has no recognised level',
        line: i + 1,
      })
    const errCell =
      cells.length === header.count ? cells[header.idx.errors] : cells[cells.length - 1]
    endpoints.push({
      id,
      method: primary.method,
      path: primary.path,
      auth,
      aliases: rest
        .filter((r) => r.method !== primary.method || r.path !== primary.path)
        .map((r) => `${r.method} ${r.path}`),
      errors: parseErrorsCell(errCell ?? ''),
      line: i + 1,
    })
  }
  return { endpoints, problems }
}

const errKey = (e) => `${e.status} ${e.code}`
const explicitErrors = (errors) =>
  new Set(errors.filter((e) => !IMPLICIT_CODES.has(e.code)).map(errKey))

/**
 * Compare doc rows with a registry summary. Registry paths are relative to /api/v1.
 * @param {ReturnType<typeof parseContractDoc>['endpoints']} docEndpoints
 * @param {Array<{id:string,method:string,path:string,auth:string,errors:{status:number,code:string}[],aliases?:string[]}>} registryEndpoints
 * @returns {Array<{id:string,kind:string,message:string}>} empty when the doc and registry agree
 */
export function compareContract(docEndpoints, registryEndpoints) {
  const issues = []
  const doc = new Map(docEndpoints.map((e) => [e.id, e]))
  const reg = new Map(registryEndpoints.map((e) => [e.id, e]))
  for (const [id, r] of reg) {
    const d = doc.get(id)
    if (!d) {
      issues.push({
        id,
        kind: 'missing_in_docs',
        message: `registry endpoint "${id}" has no row in docs/API-CONTRACT.md section 3`,
      })
      continue
    }
    const rPath = normalizeDocPath(r.path)
    if (d.method !== r.method)
      issues.push({
        id,
        kind: 'method_mismatch',
        message: `"${id}": doc says ${d.method}, registry says ${r.method}`,
      })
    if (d.path !== rPath)
      issues.push({
        id,
        kind: 'path_mismatch',
        message: `"${id}": doc says ${d.path}, registry says ${rPath}`,
      })
    if (d.auth !== r.auth)
      issues.push({
        id,
        kind: 'auth_mismatch',
        message: `"${id}": doc says auth "${d.auth}", registry says "${r.auth}"`,
      })
    const rAliases = (r.aliases ?? [])
      .map((a) => `${r.method} ${normalizeDocPath(a)}`)
      .filter((a) => a !== `${r.method} ${rPath}`)
    const dAliases = d.aliases
    if ([...rAliases].sort().join(',') !== [...dAliases].sort().join(',')) {
      issues.push({
        id,
        kind: 'alias_mismatch',
        message: `"${id}": doc aliases [${dAliases.join(', ')}], registry aliases [${rAliases.join(', ')}]`,
      })
    }
    const dErr = explicitErrors(d.errors)
    const rErr = explicitErrors(r.errors)
    for (const k of rErr)
      if (!dErr.has(k))
        issues.push({
          id,
          kind: 'error_missing_in_docs',
          message: `"${id}": registry error "${k}" is not in the doc's Errors column`,
        })
    for (const k of dErr)
      if (!rErr.has(k))
        issues.push({
          id,
          kind: 'error_missing_in_registry',
          message: `"${id}": doc error "${k}" is not in the registry's errors`,
        })
  }
  for (const id of doc.keys()) {
    if (!reg.has(id))
      issues.push({
        id,
        kind: 'missing_in_registry',
        message: `doc endpoint "${id}" has no registry entry`,
      })
  }
  return issues
}

export function formatReport({ issues, problems }) {
  const out = []
  for (const p of problems) out.push(`  [doc line ${p.line}] ${p.id ?? '?'}: ${p.message}`)
  for (const i of issues) out.push(`  [${i.kind}] ${i.message}`)
  return out.join('\n')
}
