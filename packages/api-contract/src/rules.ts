// Shared field rules (API-CONTRACT 1.7) as Zod schemas and plain validators, so every team applies
// exactly the same rule. Browser-safe: Zod only.
import { z } from 'zod'
import { parseRoutePath } from './paths'
import { HTTP_METHODS } from './primitives'
import type { ValidationIssue } from './primitives'

// ---------- slugs ----------

/** Project slugs that cannot be used: they would shadow or confuse top-level paths. */
export const RESERVED_SLUGS = ['api', 'mock', 'health', 'static', 'assets', 'admin'] as const

export const isReservedSlug = (slug: string): boolean =>
  (RESERVED_SLUGS as readonly string[]).includes(slug)

// ---------- simple fields ----------

/** Workspace / project / preset name: 1-80 chars after trim. */
export const NameField = z.string().trim().min(1).max(80)
/** Description: at most 500 chars. Make it `.nullable()` where the endpoint allows clearing. */
export const DescriptionField = z.string().max(500)
export const EmailField = z.email().max(254)
/** A new password (register, change). Login uses `LoginPassword` so the policy is not revealed. */
export const PasswordField = z.string().min(8).max(128)
export const LoginPassword = z.string().min(1).max(128)

export const Role = z.enum(['owner', 'editor', 'viewer'])
export type Role = z.infer<typeof Role>

export const MethodField = z.enum(HTTP_METHODS)

// ---------- route path ----------

/** A route path validated with `parseRoutePath`; each failure carries the grammar issue code. */
export const RoutePath = z.string().superRefine((path, ctx) => {
  const parsed = parseRoutePath(path)
  if (!parsed.ok) {
    for (const issue of parsed.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, params: { code: issue.code } })
    }
  }
})

// ---------- cases ----------

/** The status codes a case may use in v1 (matches the database check constraint). */
export const CASE_STATUS_CODES = [
  200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503,
] as const
export type CaseStatusCode = (typeof CASE_STATUS_CODES)[number]

export const CaseStatusCodeField = z
  .number()
  .int()
  .refine((n): n is CaseStatusCode => (CASE_STATUS_CODES as readonly number[]).includes(n), {
    message: `statusCode must be one of ${CASE_STATUS_CODES.join(', ')}`,
    params: { code: 'invalid_status_code' },
  })

const hasControlChar = (s: string) => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/** Case name: 1-60 chars after trim, no control characters. (Uniqueness per route is the handler's job.) */
export const CaseName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((s) => !hasControlChar(s), {
    message: 'A case name cannot contain control characters.',
    params: { code: 'invalid_case_name' },
  })

/** `null` = inherit the project default delay; `0` = explicitly none. */
export const MAX_DELAY_MS = 10_000
export const DelayMs = z.number().int().min(0).max(MAX_DELAY_MS)

// ---------- case headers ----------

export const MAX_CASE_HEADERS = 20
export const MAX_HEADER_VALUE_LENGTH = 1000
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/
const FORBIDDEN_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'host',
  'te',
  'trailer',
])
const FORBIDDEN_PREFIXES = ['proxy-', 'x-mock-', 'access-control-']

export const isReservedHeaderName = (name: string): boolean => {
  const n = name.toLowerCase()
  return FORBIDDEN_HEADERS.has(n) || FORBIDDEN_PREFIXES.some((p) => n.startsWith(p))
}

/**
 * Validates a case's response headers. Issue paths are relative to the headers object (`[name]`),
 * codes: `too_many_headers`, `invalid_header_name`, `reserved_header`, `invalid_header_value`,
 * `header_value_too_long`.
 */
export function validateCaseHeaders(headers: Record<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const names = Object.keys(headers)
  if (names.length > MAX_CASE_HEADERS) {
    issues.push({
      path: [],
      code: 'too_many_headers',
      message: `A case can have at most ${MAX_CASE_HEADERS} headers.`,
    })
  }
  for (const name of names) {
    const value = headers[name] as string
    if (!HEADER_NAME.test(name)) {
      issues.push({
        path: [name],
        code: 'invalid_header_name',
        message: `"${name}" is not a valid header name (letters, digits and "-", up to 64 characters).`,
      })
    } else if (isReservedHeaderName(name)) {
      issues.push({
        path: [name],
        code: 'reserved_header',
        message: `"${name}" is set by the mock server and cannot be overridden.`,
      })
    }
    if (/[\r\n]/.test(value)) {
      issues.push({
        path: [name],
        code: 'invalid_header_value',
        message: 'A header value cannot contain line breaks.',
      })
    } else if (value.length > MAX_HEADER_VALUE_LENGTH) {
      issues.push({
        path: [name],
        code: 'header_value_too_long',
        message: `A header value can be at most ${MAX_HEADER_VALUE_LENGTH} characters.`,
      })
    }
  }
  return issues
}

/** Case headers as a schema: the issues of `validateCaseHeaders` keep their own codes. */
export const CaseHeaders = z.record(z.string(), z.string()).superRefine((headers, ctx) => {
  for (const issue of validateCaseHeaders(headers)) {
    ctx.addIssue({
      code: 'custom',
      path: issue.path,
      message: issue.message,
      params: { code: issue.code },
    })
  }
})

// ---------- components ----------

export const COMPONENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
export const MAX_COMPONENTS = 100
export const ComponentName = z.string().regex(COMPONENT_NAME_PATTERN, {
  message: 'A component name starts with a letter and has letters, digits and "_" (up to 64).',
})
