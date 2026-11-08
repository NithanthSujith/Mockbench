// Mapping from Zod errors to the contract's `{ path, code, message }` validation issues, and the
// PATCH-body helper. Browser-safe: Zod only.
import { z } from 'zod'
import type { ValidationIssue } from './primitives'

/**
 * Custom checks attach their machine code as `params: { code }` (`reserved_header`, `read_only`,
 * `invalid_case_name`, ...). This turns a ZodError into the issue list sent as `details` on a
 * `422 validation_failed`: a custom issue keeps its own code, `unrecognized_keys` becomes one issue
 * per unknown key (path ending at the key), anything else keeps Zod's code.
 */
export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  const out: ValidationIssue[] = []
  for (const issue of error.issues) {
    const path = issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        out.push({
          path: [...path, key],
          code: 'unrecognized_keys',
          message: `Unknown key "${key}".`,
        })
      }
      continue
    }
    const custom =
      issue.code === 'custom' && typeof issue.params?.code === 'string'
        ? issue.params.code
        : undefined
    out.push({ path, code: custom ?? issue.code, message: issue.message })
  }
  return out
}

/** A field that exists in the resource but cannot be written: sending it fails with code `read_only`. */
export const readOnlyField = (name: string) =>
  z
    .unknown()
    .optional()
    .superRefine((value, ctx) => {
      if (value !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `"${name}" is read-only and cannot be changed.`,
          params: { code: 'read_only' },
        })
      }
    })
    .meta({ readOnly: true, description: 'Read-only: sending this field is rejected.' })

type Optionalised<S extends Record<string, z.ZodType>> = { [K in keyof S]: z.ZodOptional<S[K]> }

/**
 * Body of a PATCH (API-CONTRACT 1.5): every field optional, so `{}` is a valid no-op; an explicit
 * `null` is only accepted where the field's own schema is `.nullable()`; unknown keys are rejected
 * (`unrecognized_keys`) and the listed read-only keys are rejected with the code `read_only`.
 */
export function patchBody<S extends Record<string, z.ZodType>, R extends string = never>(
  fields: S,
  readOnly: readonly R[] = [],
) {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, schema] of Object.entries(fields)) shape[key] = schema.optional()
  for (const key of readOnly) shape[key] = readOnlyField(key)
  return z.strictObject(shape as Optionalised<S> & { [K in R]: ReturnType<typeof readOnlyField> })
}
