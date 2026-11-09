/** Deep clone of JSON-like data. Own implementation: no dependence on structuredClone being present. */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => cloneJson(v)) as unknown as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) {
      // defineProperty so a key named __proto__ is copied as data, never as a prototype assignment.
      Object.defineProperty(out, k, {
        value: cloneJson((value as Record<string, unknown>)[k]),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return out as T
  }
  return value
}

/** Structural equality for JSON-like data (key order is ignored for objects, order matters for arrays). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

/** Assign `obj[key] = value` as an own data property even when `key` is `__proto__`. */
export function setOwn(obj: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
}
