// Workspace slug derivation (WS-01): from a display name to a slug that satisfies the contract's
// WorkspaceSlug rule (2-40 chars, lowercase letters/digits separated by single hyphens).

export const MAX_SLUG_LENGTH = 40

/** `Alps Chemicals` -> `alps-chemicals`. Accents are folded; anything else becomes a separator. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The first-choice slug for a name. Always valid: falls back to `workspace` when nothing usable remains. */
export function baseSlug(name: string): string {
  const s = slugify(name).slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
  if (s.length === 0) return 'workspace'
  if (s.length === 1) return `${s}-workspace`
  return s
}

/** The nth candidate (1-based): `base`, `base-2`, `base-3`, ... trimmed so it never exceeds 40 chars. */
export function candidateSlug(base: string, n: number): string {
  if (n <= 1) return base
  const suffix = `-${n}`
  return `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
}

/** The first candidate not in `taken`. */
export function firstFreeSlug(base: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const c = candidateSlug(base, n)
    if (!taken.has(c)) return c
  }
}

/** The first `count` candidates not in `taken`, in order. */
export function freeSlugs(base: string, taken: ReadonlySet<string>, count: number): string[] {
  const out: string[] = []
  for (let n = 1; out.length < count; n++) {
    const c = candidateSlug(base, n)
    if (!taken.has(c)) out.push(c)
  }
  return out
}
