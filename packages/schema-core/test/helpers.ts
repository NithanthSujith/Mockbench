import { buildPresetResolver, generate, sha1 } from '../src/index'
import type { GenContext, MockSchema, ResolvedPreset } from '../src/index'

/** The project id every golden is generated with (the UUID v5 values depend on it). */
export const PROJECT_ID = '11111111-1111-7111-8111-111111111111'

export const COMBOS = [
  'deterministic-local',
  'deterministic-path',
  'seeded-local',
  'seeded-path',
] as const
export type Combo = (typeof COMBOS)[number]

export interface ManifestEntry {
  name: string
  combos: Combo[]
  /** The case has a `<name>.presets.json` next to its schema. */
  presets?: boolean
  /** Too large to commit verbatim: the golden is `sha1`, `bytes` and `leaves` of the compact output. */
  digest?: boolean
}

// Everything is read through Vite's glob so the tests need no Node API (this package must stay pure).
const schemaFiles = import.meta.glob<MockSchema>('../fixtures/**/*.schema.json', {
  eager: true,
  import: 'default',
})
const presetFiles = import.meta.glob<ResolvedPreset[]>('../fixtures/**/*.presets.json', {
  eager: true,
  import: 'default',
})
export const goldenFiles = import.meta.glob<string>('../fixtures/**/*.golden.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})
export const manifest = Object.values(
  import.meta.glob<ManifestEntry[]>('../fixtures/corpus/manifest.json', {
    eager: true,
    import: 'default',
  }),
)[0] as ManifestEntry[]

export function schemaPathFor(name: string): string {
  const found = Object.keys(schemaFiles).find((p) => p.endsWith(`/${name}.schema.json`))
  if (!found) throw new Error(`no fixture schema named ${name}`)
  return found
}

export const schemaFor = (name: string): MockSchema =>
  schemaFiles[schemaPathFor(name)] as MockSchema

export const presetsFor = (name: string): ResolvedPreset[] | undefined =>
  presetFiles[schemaPathFor(name).replace('.schema.json', '.presets.json')]

export const goldenPathFor = (name: string, combo: Combo): string =>
  schemaPathFor(name).replace('.schema.json', `.${combo}.golden.txt`)

export const allSchemas = (): [string, MockSchema][] =>
  Object.entries(schemaFiles).map(([p, s]) => [p, s])

export function contextFor(entry: ManifestEntry, combo: Combo): GenContext {
  const [mode, indexing] = combo.split('-') as ['deterministic' | 'seeded', 'local' | 'path']
  const presets = entry.presets ? presetsFor(entry.name) : undefined
  return {
    projectId: PROJECT_ID,
    settings: { indexing, mode },
    ...(presets ? { presets: buildPresetResolver(presets) } : {}),
  }
}

export const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

export function countLeaves(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + countLeaves(v), 0)
  if (value !== null && typeof value === 'object')
    return Object.values(value).reduce<number>((n, v) => n + countLeaves(v), 0)
  return 1
}

/** The exact text that is (or would be) committed as a golden for this case. */
export function renderGolden(entry: ManifestEntry, combo: Combo): string {
  const schema = schemaFor(entry.name)
  if (entry.digest) {
    const { json } = generate(schema, contextFor(entry, combo))
    const bytes = new TextEncoder().encode(json)
    return `sha1 ${hex(sha1(bytes))}\nbytes ${bytes.length}\nleaves ${countLeaves(JSON.parse(json))}\n`
  }
  return `${generate(schema, contextFor(entry, combo), { indent: 2 }).json}\n`
}

/** Hash over every committed golden (path + content), used by the generator change guard. */
export function goldensHash(files: Record<string, string> = goldenFiles): string {
  // path and content are separated by newlines; a golden containing "\n--\n" cannot forge another file's entry
  // because every entry is length-prefixed.
  const parts = Object.keys(files)
    .sort()
    .map((p) => `${p.length}:${p}\n${(files[p] ?? '').length}:${files[p]}\n`)
  return hex(sha1(new TextEncoder().encode(parts.join(''))))
}

/**
 * Resolves `relative` against the directory of a `file:///` URL and returns a plain path that esbuild
 * and ESLint accept. Plain string handling on purpose: no Node `url` module, and happy-dom's global
 * `URL` does not resolve `file:` bases correctly.
 */
export function resolveFromModule(metaUrl: string, relative: string): string {
  const path = decodeURIComponent(metaUrl.replace(/^file:\/\/\/?/, ''))
  const lead = /^[A-Za-z]:/.test(path) ? '' : '/'
  const parts = path.split('/').slice(0, -1) // drop the file name
  for (const seg of relative.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return lead + parts.join('/')
}
