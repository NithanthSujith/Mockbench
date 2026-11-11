// Workspace-slug helpers for the new-workspace dialog (API-CONTRACT 1.7: 2-40 characters).
export const WS_SLUG_MIN = 2
export const WS_SLUG_MAX = 40
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const WS_SLUG_RULE = `Use lowercase letters, digits and single hyphens, ${WS_SLUG_MIN}-${WS_SLUG_MAX} characters.`
export const WS_SLUG_TAKEN = 'That slug is already used by another workspace'

/** `Alps Chemicals` -> `alps-chemicals`. */
export function deriveWorkspaceSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, WS_SLUG_MAX)
    .replace(/-+$/, '')
}

export function workspaceSlugProblem(slug: string): string | null {
  if (slug === '') return null
  if (slug.length < WS_SLUG_MIN || slug.length > WS_SLUG_MAX || !SLUG_PATTERN.test(slug))
    return WS_SLUG_RULE
  return null
}
