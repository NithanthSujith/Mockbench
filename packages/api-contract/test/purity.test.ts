// Static import-graph inspection standing in for a bundle test (esbuild is not a dependency; FND-05
// adds the real browser-platform bundle test for schema-core). Walks the MAIN entry's relative imports.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => resolve(pkgRoot, 'src', p)

const NODE_BUILTINS = new Set(
  (
    'fs path crypto os child_process http https http2 net tls dns buffer process stream zlib url util events ' +
    'worker_threads readline vm module assert cluster dgram perf_hooks querystring string_decoder'
  ).split(' '),
)

function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [
    ...text.matchAll(
      /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g,
    ),
  ].map((m) => (m[1] ?? m[2] ?? m[3]) as string)
}

function graph(entry: string) {
  const seen = new Set<string>()
  const external = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const spec of specifiers(file)) {
      if (spec.startsWith('.')) {
        const base = resolve(dirname(file), spec)
        visit(base.endsWith('.ts') ? base : `${base}.ts`)
      } else external.add(spec)
    }
  }
  visit(entry)
  return {
    files: [...seen].map((f) => f.replace(`${pkgRoot}`, '').replaceAll('\\', '/')),
    external: [...external],
  }
}

describe('main entry (@mockbench/api-contract) is browser-safe', () => {
  const main = graph(src('index.ts'))

  it('imports no Node builtin (bare or node: prefixed)', () => {
    const offenders = main.external.filter(
      (s) => s.startsWith('node:') || NODE_BUILTINS.has(s.split('/')[0] as string),
    )
    expect(offenders).toEqual([])
  })

  it('imports only zod', () => {
    expect(main.external).toEqual(['zod'])
  })

  it('does not reach the OpenAPI generator or its library', () => {
    expect(main.files).not.toContain('/src/openapi.ts')
    expect(main.external).not.toContain('@asteasolutions/zod-to-openapi')
  })
})

describe('the OpenAPI generator is a separate entry point', () => {
  it('is exposed as the ./openapi subpath and not re-exported from the main entry', () => {
    const pkg = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, string>
    }
    expect(pkg.exports['./openapi']).toBe('./src/openapi.ts')
    expect(specifiers(src('index.ts'))).not.toContain('./openapi')
  })

  it('the generator entry does import the library (so the split is real)', () => {
    expect(graph(src('openapi.ts')).external).toContain('@asteasolutions/zod-to-openapi')
  })
})
