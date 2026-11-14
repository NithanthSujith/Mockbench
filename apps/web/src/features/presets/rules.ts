import {
  MAX_PRESET_RULES,
  PresetRuleSchema,
  applyPattern,
  buildPresetResolver,
  generate,
  type Json,
  type MockNode,
  type NodeType,
  type PresetRule,
} from '@mockbench/schema-core'

// Pure logic for the presets screen: editable drafts <-> PresetRule, validation messages, the live
// sample and the JSON export/import file. No React here.

export type Kind = 'value' | 'values' | 'pattern'
export const KINDS: readonly Kind[] = ['value', 'values', 'pattern']
export const ANY_TYPE = 'any'
export const PRIORITY_MIN = -2_147_483_648
export const PRIORITY_MAX = 2_147_483_647
export const SAMPLE_COUNT = 4

/** One row of the rule table while it is being edited. Everything is text, like the inputs. */
export interface RuleDraft {
  id: string
  key: string
  path: string
  type: string
  kind: Kind
  text: string
}

let counter = 0
export const newDraftId = (): string => `rule-${++counter}`

export function blankDraft(): RuleDraft {
  return { id: newDraftId(), key: '', path: '', type: ANY_TYPE, kind: 'value', text: '' }
}

/** A typed value: JSON when it parses (`12`, `true`, `"a b"`), the plain text otherwise (`INR`). */
export function parseLoose(text: string): Json {
  const t = text.trim()
  try {
    return JSON.parse(t) as Json
  } catch {
    return t
  }
}

/** The inverse of `parseLoose`: strings that would be read as something else are quoted. */
export function displayLoose(value: Json): string {
  if (typeof value !== 'string') return JSON.stringify(value)
  if (value === '' || value !== value.trim()) return JSON.stringify(value)
  try {
    JSON.parse(value)
    return JSON.stringify(value)
  } catch {
    return value
  }
}

function parseList(text: string): Json[] {
  const t = text.trim()
  if (t.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(t)
      if (Array.isArray(parsed)) return parsed as Json[]
    } catch {
      // fall through to the comma-separated reading
    }
  }
  return t
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(parseLoose)
}

function displayList(values: Json[]): string {
  const needsJson = values.some((v) => typeof v === 'string' && v.includes(','))
  return needsJson ? JSON.stringify(values) : values.map(displayLoose).join(', ')
}

export function draftFromRule(rule: PresetRule): RuleDraft {
  const kind: Kind = Object.hasOwn(rule, 'value')
    ? 'value'
    : rule.values !== undefined
      ? 'values'
      : 'pattern'
  const text =
    kind === 'value'
      ? displayLoose(rule.value as Json)
      : kind === 'values'
        ? displayList(rule.values as Json[])
        : (rule.pattern as string)
  return {
    id: newDraftId(),
    key: rule.match.key ?? '',
    path: rule.match.path ?? '',
    type: rule.match.type ?? ANY_TYPE,
    kind,
    text,
  }
}

export interface RuleProblems {
  match?: string
  output?: string
}

const OUTPUT_PROMPT: Record<Kind, string> = {
  value: 'Enter a value, e.g. INR (type "" for an empty string).',
  values: 'Enter at least one value, separated by commas.',
  pattern: 'Enter a pattern, e.g. ID-{n:05}.',
}

/** The rule a draft describes, or the messages explaining why it cannot be saved yet. */
export function ruleFromDraft(
  d: RuleDraft,
): { rule: PresetRule; problems?: undefined } | { rule?: undefined; problems: RuleProblems } {
  const match: Record<string, string> = {}
  if (d.key.trim() !== '') match.key = d.key.trim()
  if (d.path.trim() !== '') match.path = d.path.trim()
  if (d.type !== ANY_TYPE && d.type !== '') match.type = d.type
  const candidate: Record<string, unknown> = { match }
  const problems: RuleProblems = {}
  const blank = d.text.trim() === ''
  if (d.kind === 'value') {
    if (!blank) candidate.value = parseLoose(d.text)
  } else if (d.kind === 'values') {
    const list = parseList(d.text)
    if (list.length > 0) candidate.values = list
  } else if (!blank) {
    candidate.pattern = d.text.trim()
  }
  if (Object.keys(match).length === 0) {
    problems.match = 'Match on a key, a path or a type.'
  }
  if (blank || (d.kind === 'values' && !('values' in candidate))) {
    problems.output = OUTPUT_PROMPT[d.kind]
  }
  const parsed = PresetRuleSchema.safeParse(candidate)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'match') problems.match ??= issue.message
      else problems.output ??= issue.message
    }
  }
  if (problems.match !== undefined || problems.output !== undefined || !parsed.success) {
    return { problems }
  }
  return { rule: parsed.data }
}

export function nameProblem(name: string): string | undefined {
  const t = name.trim()
  if (t === '') return 'Name the preset.'
  if (t.length > 80) return 'Use 80 characters or fewer.'
  return undefined
}

export function priorityProblem(text: string): string | undefined {
  const t = text.trim()
  if (!/^-?\d+$/.test(t)) return 'Priority is a whole number.'
  const n = Number(t)
  if (n < PRIORITY_MIN || n > PRIORITY_MAX) return 'Priority is out of range.'
  return undefined
}

// ---------- live sample ----------

export interface SampleRow {
  /** What the rule matches, e.g. `currency` or `$.address.city`. */
  label: string
  /** The generated values joined with commas, or a note when no sample is possible. */
  text: string
}

const NON_LEAF: readonly string[] = ['object', 'array', 'ref']

function leafNode(type: NodeType): MockNode {
  return type === 'enum' ? { type, values: ['a', 'b', 'c'] } : { type }
}

function flatten(value: unknown, out: unknown[]): void {
  if (Array.isArray(value)) for (const v of value) flatten(v, out)
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) flatten(v, out)
  } else out.push(value)
}

const show = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

/**
 * Applies `rules` (as one preset) to a tiny schema built from each rule's own match: a key rule gets
 * `{ key: [4 elements] }`, a path rule gets that path with every `[*]` four elements long. Because the
 * real resolver runs, a more specific rule in the same preset shows through, exactly as on publish.
 */
export function buildSample(rules: readonly PresetRule[], priority: number): SampleRow[] {
  const resolver = buildPresetResolver([{ priority, rules: [...rules] }])
  return rules.map((rule): SampleRow => {
    const { key, path, type } = rule.match
    const label = path ?? key ?? `type ${type ?? ''}`
    const nodeType: NodeType = type ?? 'string'
    if (NON_LEAF.includes(nodeType)) {
      return { label, text: 'Rules apply to leaf fields only.' }
    }
    let node: MockNode = leafNode(nodeType)
    if (path !== undefined) {
      const tokens = [...path.matchAll(/\.([^.[\]]+)|\[\*\]/g)].map((m) => m[1] ?? null)
      for (const token of tokens.reverse()) {
        node =
          token === null
            ? { type: 'array', items: node, count: SAMPLE_COUNT }
            : { type: 'object', fields: [{ key: token, node }] }
      }
    } else {
      const field = key !== undefined ? key.replaceAll('*', 'sample') : 'sample'
      node = {
        type: 'object',
        fields: [{ key: field, node: { type: 'array', items: node, count: SAMPLE_COUNT } }],
      }
    }
    try {
      const out = generate(
        { version: 1, components: {}, root: node },
        {
          projectId: '00000000-0000-7000-8000-000000000000',
          settings: { indexing: 'local', mode: 'deterministic' },
          presets: resolver,
        },
      )
      const values: unknown[] = []
      flatten(JSON.parse(out.json), values)
      return { label, text: values.map(show).join(', ') }
    } catch {
      return { label, text: 'No sample for this match.' }
    }
  })
}

/** `n=1` and `n=12` renderings of a pattern. */
export function patternPreview(pattern: string, key: string): { n: number; text: string }[] {
  return [1, 12].map((n) => ({ n, text: applyPattern(pattern, n, key === '' ? 'key' : key) }))
}

// ---------- export / import ----------

export interface PresetFile {
  name: string
  priority: number
  rules: PresetRule[]
}

export function exportFileName(name: string): string {
  const base =
    [...name.trim()]
      .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '-' : c))
      .join('')
      .replace(/-{2,}/g, '-') || 'preset'
  return `${base}.preset.json`
}

export function exportText(file: PresetFile): string {
  return `${JSON.stringify({ name: file.name, priority: file.priority, rules: file.rules }, null, 2)}\n`
}

export type ImportResult = { ok: true; file: PresetFile } | { ok: false; issues: string[] }

const issuePath = (path: PropertyKey[]): string =>
  path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join('')

/** Validates an uploaded file's text. Every problem is listed, rule problems with their `rules[i]`. */
export function parseImport(text: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, issues: ['The file is not valid JSON.'] }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: ['Expected an object with name, priority and rules.'] }
  }
  const obj = raw as Record<string, unknown>
  const issues: string[] = []
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  if (typeof obj.name !== 'string' || nameProblem(name) !== undefined) {
    issues.push('name: must be a string of 1 to 80 characters.')
  }
  const priority = obj.priority === undefined ? 0 : obj.priority
  if (typeof priority !== 'number' || !Number.isInteger(priority)) {
    issues.push('priority: must be a whole number.')
  } else if (priority < PRIORITY_MIN || priority > PRIORITY_MAX) {
    issues.push('priority: out of range.')
  }
  const rules: PresetRule[] = []
  if (!Array.isArray(obj.rules)) {
    issues.push('rules: must be an array.')
  } else {
    if (obj.rules.length > MAX_PRESET_RULES) {
      issues.push(`rules: at most ${MAX_PRESET_RULES} rules.`)
    }
    obj.rules.forEach((candidate: unknown, i) => {
      const parsed = PresetRuleSchema.safeParse(candidate)
      if (parsed.success) {
        rules.push(parsed.data)
        return
      }
      for (const issue of parsed.error.issues) {
        const where = issuePath(issue.path)
        issues.push(`rules[${i}]${where === '' ? '' : `.${where}`}: ${issue.message}`)
      }
    })
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, file: { name, priority: priority as number, rules } }
}
