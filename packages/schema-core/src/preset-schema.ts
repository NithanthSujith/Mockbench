import { z } from 'zod'
import { NODE_TYPES } from './types'
import type { Json } from './types'

// The Zod rule schemas live apart from the resolver on purpose: the browser preview needs
// `buildPresetResolver` but not Zod, and a module with top-level `z.*` calls cannot be tree-shaken.

/** A preset holds at most this many rules (PRJ-02 relies on it). */
export const MAX_PRESET_RULES = 500

const jsonZod = z.json() as unknown as z.ZodType<Json>

/** `$` followed by `.key` segments and `[*]` (any array element): `$.address.city`, `$.orders[*].total`. */
const PATH_RE = /^\$(?:\.[^.[\]]+|\[\*\])*$/

const matchZod = z
  .strictObject({
    key: z.string().min(1).optional(),
    path: z
      .string()
      .regex(PATH_RE, 'path must look like $.address.city or $.orders[*].total')
      .optional(),
    type: z.enum(NODE_TYPES).optional(),
  })
  .refine((m) => m.key !== undefined || m.path !== undefined || m.type !== undefined, {
    message: 'match needs at least one of key, path or type',
  })

const OUTPUTS = ['value', 'values', 'pattern'] as const

/**
 * One preset rule: `match` says which fields it applies to, and exactly one of `value` (a literal,
 * same every time), `values` (cycled by ordinal) or `pattern` (`{n}`, `{n:0N}`, `{key}`) says what to
 * produce. `value` may be any JSON, including `null`, `0`, `false` and `""`: presence of the key decides.
 */
export const PresetRuleSchema = z
  .strictObject({
    match: matchZod,
    value: jsonZod.optional(),
    values: z.array(jsonZod).min(1, 'values must not be empty').optional(),
    pattern: z.string().min(1, 'pattern must not be empty').optional(),
  })
  .superRefine((rule, ctx) => {
    const present = OUTPUTS.filter((k) => Object.hasOwn(rule, k))
    if (present.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message:
          present.length === 0
            ? 'a rule needs exactly one of value, values or pattern'
            : `a rule must have exactly one of value, values or pattern (found ${present.join(', ')})`,
      })
    }
  })

export type PresetRule = z.infer<typeof PresetRuleSchema>

/** A whole rule list, capped at `MAX_PRESET_RULES`. Issue paths point into `[i]` of the offending rule. */
export const PresetRulesSchema = z.array(PresetRuleSchema).max(MAX_PRESET_RULES)
