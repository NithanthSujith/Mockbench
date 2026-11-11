// Project-slug helpers for the new-project dialog. The rules mirror API-CONTRACT 1.7 and the
// contract's `Slug` / `RESERVED_SLUGS` (slug.test.ts compares them). They are repeated here because
// production web code does not import the contract's runtime (it would pull Zod into the bundle).

export const SLUG_MIN = 3
export const SLUG_MAX = 40
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const RESERVED_SLUGS: readonly string[] = [
  'api',
  'mock',
  'health',
  'static',
  'assets',
  'admin',
]

export const SLUG_FORMAT_RULE = `Use lowercase letters, digits and single hyphens, ${SLUG_MIN}-${SLUG_MAX} characters.`
export const SLUG_TAKEN_MESSAGE = 'That URL slug is already used by another project on this server'

/** `Billing API v2` -> `billing-api-v2`. */
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
}

/** The first problem with a slug, or null. An empty slug has no message (the field is just incomplete). */
export function slugProblem(slug: string): string | null {
  if (slug === '') return null
  if (RESERVED_SLUGS.includes(slug)) return `${slug} is reserved`
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || !SLUG_PATTERN.test(slug)) {
    return SLUG_FORMAT_RULE
  }
  return null
}
