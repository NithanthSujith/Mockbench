// Shared Zod primitives for the HTTP contract (docs/API-CONTRACT.md section 1 and 2).
// Browser-safe: Zod only. Zod 4 idioms per ADR 0016.
import { z } from 'zod'

/** UUID (v7 in practice; any RFC 9562 UUID is accepted on input). */
export const Id = z.uuid()

/** ISO-8601 UTC with milliseconds and a literal `Z`, e.g. 2026-11-05T08:30:00.000Z. */
export const Timestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    'ISO-8601 UTC timestamp with milliseconds',
  )

/** Lowercase alphanumeric segments joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** Project slug: 3-40 chars. Reserved-slug rejection is a handler/FND-07 concern, not format. */
export const Slug = z
  .string()
  .min(3)
  .max(40)
  .regex(SLUG_PATTERN, 'lowercase letters, digits and single hyphens')
/** Workspace slug: 2-40 chars, no reserved list. */
export const WorkspaceSlug = z
  .string()
  .min(2)
  .max(40)
  .regex(SLUG_PATTERN, 'lowercase letters, digits and single hyphens')

/** Stable snake_case machine code (API-CONTRACT 1.3). Clients branch on this, never on `message`. */
export const ErrorCode = z.string().regex(/^[a-z][a-z0-9_]*$/, 'snake_case machine code')

/** One entry of `details` on a 422 validation_failed. `path` is relative to the request body,
 *  or starts with "query" / "params". */
export const ValidationIssue = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string(),
  message: z.string(),
})
export type ValidationIssue = z.infer<typeof ValidationIssue>

/** The error envelope returned by every control-plane error. `details` is ALWAYS an array. */
export const ErrorEnvelope = z
  .strictObject({
    error: ErrorCode,
    message: z.string(),
    details: z.array(z.unknown()),
  })
  // `id` makes the OpenAPI generator hoist it into components.schemas.ErrorEnvelope.
  .meta({ id: 'ErrorEnvelope' })
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>

/** `{ items, nextCursor }` list envelope (API-CONTRACT 1.4). Unpaginated lists use nextCursor: null. */
export const paginated = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() })

/** Query parameters of paginated lists. `limit` defaults to 50; `cursor` is opaque. */
export const PageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
})
export type PageQuery = z.infer<typeof PageQuery>

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/** Auth levels from the legend in API-CONTRACT 1.3. Role levels imply workspace membership. */
export const AUTH_LEVELS = ['public', 'session', 'viewer', 'editor', 'owner'] as const
export type AuthLevel = (typeof AUTH_LEVELS)[number]

/** Codes any endpoint may return (API-CONTRACT 1.3 "Global codes"); not repeated per endpoint. */
export const GLOBAL_ERRORS = [
  { status: 400, code: 'invalid_json' },
  { status: 403, code: 'csrf_rejected' },
  { status: 413, code: 'payload_too_large' },
  { status: 415, code: 'unsupported_media_type' },
  { status: 422, code: 'validation_failed' },
  { status: 429, code: 'rate_limited' },
  { status: 500, code: 'internal_error' },
  { status: 501, code: 'not_implemented' },
] as const
export type GlobalErrorCode = (typeof GLOBAL_ERRORS)[number]['code']
