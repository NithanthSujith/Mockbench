import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ROOT,
  brokenLinks,
  configVars,
  docFiles,
  envExampleVars,
  externalAssets,
  undocumentedVars,
  // @ts-expect-error plain .mjs library without type declarations
} from './docs-check-lib.mjs'
import { ProjectExport, parseRoutePath } from '../packages/api-contract/src/index'
import { validateSchema } from '../packages/schema-core/src/index'

describe('docs: environment variables', () => {
  it('finds the variables it is supposed to check', () => {
    expect(envExampleVars()).toContain('SESSION_SECRET')
    expect(configVars()).toContain('CONTROL_RATE_LIMIT')
  })

  it('documents every variable in .env.example and in config.ts', () => {
    expect(undocumentedVars()).toEqual([])
  })
})

describe('docs: links and offline use', () => {
  it('has docs to check', () => {
    expect(docFiles().length).toBeGreaterThan(5)
  })

  it('every relative link resolves', () => {
    expect(brokenLinks()).toEqual([])
  })

  it('loads no external assets', () => {
    expect(externalAssets()).toEqual([])
  })

  it('states the threat model in bold in the README and in the docs', () => {
    const phrase = /\*\*[^*]*no authentication[^*]*\*\*/i
    expect(readFileSync(`${ROOT}/README.md`, 'utf8')).toMatch(phrase)
    expect(readFileSync(`${ROOT}/docs/site/index.md`, 'utf8')).toMatch(phrase)
    expect(readFileSync(`${ROOT}/docs/site/getting-started.md`, 'utf8')).toMatch(phrase)
  })
})

describe('examples', () => {
  const dir = `${ROOT}/examples`
  const files = readdirSync(dir).filter((f) => f.endsWith('.mockbench.json'))

  it('ships at least three exported projects and sample payloads', () => {
    expect(files.length).toBeGreaterThanOrEqual(3)
    expect(readdirSync(`${dir}/payloads`).length).toBeGreaterThanOrEqual(1)
  })

  describe.each(files)('%s', (file) => {
    const doc = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'))

    it('is a valid ProjectExport', () => {
      const parsed = ProjectExport.safeParse(doc)
      expect(parsed.success ? [] : parsed.error.issues).toEqual([])
    })

    it('is named after its slug', () => {
      expect(file).toBe(`${doc.project.slug}.mockbench.json`)
    })

    it('has valid route paths, one default case per route, and unique methods and paths', () => {
      const seen = new Set<string>()
      for (const route of doc.routes) {
        expect(parseRoutePath(route.path).ok, route.path).toBe(true)
        const key = `${route.method} ${route.path}`
        expect(seen.has(key), `duplicate ${key}`).toBe(false)
        seen.add(key)
        expect(route.cases.filter((c: { isDefault: boolean }) => c.isDefault)).toHaveLength(1)
      }
    })

    it('has valid MockSchemas, resolving refs against the project components', () => {
      for (const route of doc.routes) {
        for (const c of route.cases) {
          const result = validateSchema(c.schema, { components: doc.project.components })
          expect(
            result.ok ? [] : result.issues,
            `${route.method} ${route.path} / ${c.name}`,
          ).toEqual([])
        }
      }
    })
  })
})
