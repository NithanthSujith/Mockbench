/**
 * Expands a preset `pattern`: `{n}` is the ordinal, `{n:0N}` the ordinal zero-padded to N digits
 * (`{n:05}` -> `00007`), `{key}` the field key. Unknown `{...}` sequences are left untouched.
 * Lives here because the generator needs it; FND-04 re-exports and tests it as part of the presets engine.
 */
export function applyPattern(pattern: string, n: number, key: string): string {
  return pattern
    .replace(/\{n:0(\d+)\}/g, (_m, width: string) => String(n).padStart(Number(width), '0'))
    .replace(/\{n\}/g, String(n))
    .replace(/\{key\}/g, key)
}
