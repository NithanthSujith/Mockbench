import type { PresetHit, PresetQuery, PresetResolver } from './generate'
import type { PresetRule } from './preset-schema'
import type { Json, NodeType } from './types'

export type { PresetRule }

export interface ResolvedPreset {
  priority: number
  rules: PresetRule[]
}

interface CompiledRule {
  order: number
  priority: number
  score: number
  path?: string
  key?: RegExp
  type?: NodeType
  hit: PresetHit
}

/** `*` matches any run of characters; every other character, including regex metacharacters, is literal. */
function globToRegExp(glob: string): RegExp {
  const body = glob
    .split('*')
    .map((part) => part.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}$`, 's')
}

/**
 * Specificity: `path` 100 · exact `key` 50 · glob `key` 30 · plus 10 when `type` is also given ·
 * a bare `type` is 10.
 */
function specificity(match: PresetRule['match']): number {
  let base = 0
  if (match.path !== undefined) base = 100
  else if (match.key !== undefined) base = match.key.includes('*') ? 30 : 50
  return base + (match.type !== undefined ? 10 : 0)
}

function toHit(rule: PresetRule): PresetHit {
  if (Object.hasOwn(rule, 'value')) return { value: rule.value as Json }
  if (rule.values) return { values: rule.values }
  return { pattern: rule.pattern as string }
}

/**
 * Builds the resolver the generator consults for every leaf. Rules apply to leaf nodes only. The most
 * specific matching rule wins; ties go to the higher preset `priority`, then to the later rule (later
 * within a preset; across presets, the later one in the array). Invalid rules are the caller's problem:
 * validate with `PresetRulesSchema` first.
 */
export function buildPresetResolver(presets: readonly ResolvedPreset[]): PresetResolver {
  const compiled: CompiledRule[] = []
  let order = 0
  for (const preset of presets) {
    for (const rule of preset.rules) {
      const m = rule.match
      compiled.push({
        order: order++,
        priority: preset.priority,
        score: specificity(m),
        ...(m.path !== undefined ? { path: m.path } : {}),
        ...(m.key !== undefined ? { key: globToRegExp(m.key) } : {}),
        ...(m.type !== undefined ? { type: m.type } : {}),
        hit: toHit(rule),
      })
    }
  }

  const better = (a: CompiledRule, b: CompiledRule): boolean =>
    a.score !== b.score
      ? a.score > b.score
      : a.priority !== b.priority
        ? a.priority > b.priority
        : a.order > b.order

  const memo = new Map<string, PresetHit | null>()
  return (q: PresetQuery): PresetHit | null => {
    const memoKey = `${q.type}\u0000${q.key ?? '\u0001'}\u0000${q.schemaPath}`
    const cached = memo.get(memoKey)
    if (cached !== undefined) return cached
    let best: CompiledRule | undefined
    for (const r of compiled) {
      if (r.type !== undefined && r.type !== q.type) continue
      if (r.path !== undefined && r.path !== q.schemaPath) continue
      if (r.key !== undefined && (q.key === null || !r.key.test(q.key))) continue
      if (!best || better(r, best)) best = r
    }
    const result = best ? best.hit : null
    memo.set(memoKey, result)
    return result
  }
}

export interface StarterPreset {
  name: string
  priority: number
  rules: PresetRule[]
}

/** Packs offered by "Add from template". The first is a small realistic set; the second is a blank start. */
export const STARTER_PRESETS: readonly StarterPreset[] = [
  {
    name: 'Indian B2B (sample)',
    priority: 10,
    rules: [
      { match: { key: 'role' }, values: ['admin', 'manager', 'viewer'] },
      { match: { key: 'currency' }, value: 'INR' },
      { match: { key: 'city' }, values: ['Ahmedabad', 'Surat', 'Pune'] },
      { match: { path: '$.address.city' }, values: ['Ahmedabad', 'Mumbai', 'Bengaluru'] },
      { match: { key: '*_id', type: 'string' }, pattern: 'ID-{n:05}' },
      { match: { key: 'gstin' }, pattern: '24AAACA{n:04}Z' },
      { match: { key: 'sku' }, pattern: 'ALP-{n:03}' },
      { match: { key: 'godown' }, values: ['Vatva', 'Naroda', 'Sanand'] },
      { match: { key: 'pincode' }, value: 380015 },
    ],
  },
  { name: 'Empty template', priority: 0, rules: [] },
]
