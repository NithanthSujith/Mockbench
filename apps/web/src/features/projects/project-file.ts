// The project export file (PRJ-06, API-CONTRACT 3.11) as the browser sees it: a loose reader that
// pulls out what the import dialog needs (name, slug, counts, default-case warnings) and leaves every
// real check to the server. Types only from the contract: its runtime stays out of the bundle.

export const SUPPORTED_FORMAT_VERSION = 1

export interface ImportIssue {
  path: (string | number)[]
  code: string
  message: string
}

export interface ReadFile {
  document: unknown
  name: string
  slug: string
  routeCount: number
  caseCount: number
  warnings: string[]
}

export type ReadResult = { ok: true; file: ReadFile } | { ok: false; issues: ImportIssue[] }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const fail = (code: string, message: string, path: (string | number)[] = []): ReadResult => ({
  ok: false,
  issues: [{ path, code, message }],
})

/** Parses the text of a chosen file. Malformed JSON and unsupported versions are caught here. */
export function readProjectFile(text: string): ReadResult {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return fail('invalid_json', 'The file is not valid JSON.')
  }
  if (!isObject(doc)) return fail('invalid_document', 'The file is not a Mockbench project export.')
  if (doc.formatVersion !== SUPPORTED_FORMAT_VERSION) {
    return fail(
      'unsupported_format_version',
      `Unsupported formatVersion ${JSON.stringify(doc.formatVersion) ?? 'missing'}; this server reads version ${SUPPORTED_FORMAT_VERSION}.`,
      ['formatVersion'],
    )
  }
  const project = isObject(doc.project) ? doc.project : {}
  const routes = Array.isArray(doc.routes) ? doc.routes : []
  const warnings: string[] = []
  let caseCount = 0
  routes.forEach((route) => {
    const r = isObject(route) ? route : {}
    const cases = Array.isArray(r.cases) ? r.cases : []
    caseCount += cases.length
    const marked = cases.filter((c) => isObject(c) && c.isDefault === true).length
    const label = `${String(r.method ?? '?')} ${String(r.path ?? '?')}`
    if (marked > 1) {
      warnings.push(`${label} marks ${marked} cases as default; only the first stays the default.`)
    } else if (marked === 0 && cases.length > 0) {
      warnings.push(`${label} has no default case; its first case becomes the default.`)
    }
  })
  return {
    ok: true,
    file: {
      document: doc,
      name: typeof project.name === 'string' ? project.name : '',
      slug: typeof project.slug === 'string' ? project.slug : '',
      routeCount: routes.length,
      caseCount,
      warnings,
    },
  }
}

/** The `details` of an error envelope as issues; entries that are not `{ path, code, message }` are skipped. */
export function issuesFromDetails(details: unknown[]): ImportIssue[] {
  const out: ImportIssue[] = []
  for (const d of details) {
    if (!isObject(d) || typeof d.message !== 'string') continue
    out.push({
      path: Array.isArray(d.path) ? (d.path as (string | number)[]) : [],
      code: typeof d.code === 'string' ? d.code : 'invalid',
      message: d.message,
    })
  }
  return out
}

/** `routes[1].cases[0].name` for a path into the document. */
export function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return '(document)'
  return path.reduce<string>(
    (acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : seg),
    '',
  )
}

/** The pretty, newline-terminated text of an export, so a file diffs well when committed. */
export function exportText(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

export const exportFileName = (slug: string): string => `${slug}.mockbench.json`
