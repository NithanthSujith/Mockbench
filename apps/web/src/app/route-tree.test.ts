import { describe, expect, it } from 'vitest'
import routeTreeSource from '../routeTree.gen.ts?raw'

// Lives in src/app (not src/routes): everything in src/routes is a route file to the router plugin.
// Route files are frozen wiring (docs/TEAMS.md 2.1): they import screens, loaders and shell pieces
// and nothing else. These checks run over their source text so no Node APIs are needed.
const routeFiles = import.meta.glob('../routes/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
// Canonical absolute paths (/src/...) of every source file, whatever directory the glob key is relative to.
const everySource = Object.keys(
  import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], { eager: false }),
).map((key) => new URL(key, 'file:///src/app/x.test.ts').pathname)

/** Resolves `rel` (relative to a route file) to a source file under src, or undefined if missing. */
function resolve(rel: string): string | undefined {
  const base = new URL(rel, 'file:///src/routes/x.tsx').pathname
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base].find((p) =>
    everySource.includes(p),
  )
}

describe('route files', () => {
  it('found the route files', () => {
    expect(Object.keys(routeFiles).length).toBeGreaterThanOrEqual(15)
  })

  it('every relative import in a route file resolves to a real file (a missing feature fails here and in tsc)', () => {
    const missing: string[] = []
    for (const [file, text] of Object.entries(routeFiles)) {
      for (const m of text.matchAll(/from '(\.[^']+)'/g)) {
        if (!resolve(m[1] as string)) missing.push(`${file} -> ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('route files import only from features, shell, lib and app (wiring only)', () => {
    const offenders: string[] = []
    for (const [file, text] of Object.entries(routeFiles)) {
      for (const m of text.matchAll(/from '(\.\.\/[^']+)'/g)) {
        if (!/^\.\.\/(features|shell|lib|app)\//.test(m[1] as string))
          offenders.push(`${file} -> ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every feature screen a route imports lives under features/<area>/screens', () => {
    for (const text of Object.values(routeFiles)) {
      for (const m of text.matchAll(/from '\.\.\/features\/([a-z]+)\/([^']+)'/g)) {
        expect(m[2], `${m[0]}`).toMatch(/^(screens\/[A-Za-z]+|route-loaders|search)$/)
      }
    }
  })

  it('there is no import route (OpenAPI import is deferred, ADR 0010)', () => {
    expect(Object.keys(routeFiles).filter((f) => /import/i.test(f))).toEqual([])
  })
})

describe('routeTree.gen.ts is committed and complete', () => {
  const expected = [
    '/login',
    '/register',
    '/_dev/ui',
    '/w/$wsSlug',
    '/w/$wsSlug/members',
    '/p/$projectSlug',
    '/p/$projectSlug/routes/$routeId',
    '/p/$projectSlug/routes/$routeId/cases/$caseId',
    '/p/$projectSlug/versions',
    '/p/$projectSlug/presets',
    '/p/$projectSlug/logs',
    '/p/$projectSlug/settings',
  ]
  const fullPaths =
    /interface FileRoutesByFullPath \{([\s\S]*?)\n\}/.exec(routeTreeSource)?.[1] ?? ''

  it('lists every path from the contract table', () => {
    for (const path of expected) {
      expect(fullPaths, path).toContain(`'${path}':`)
    }
  })

  it('has no import path', () => {
    expect(fullPaths).not.toMatch(/import/)
  })
})
