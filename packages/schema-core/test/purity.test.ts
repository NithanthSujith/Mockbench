import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import {
  NODE_BUILTINS,
  REPO_ROOT,
  SRC_DIR,
  bundle,
  bundleSnippet,
  bundledInputs,
  externalImports,
} from './bundle'

const BUILTIN_RE = new RegExp(
  `(?:from|import|require)\\s*\\(?\\s*["'](?:node:[a-z_/]+|(?:${NODE_BUILTINS.join('|')})(?:/[a-z_]+)?)["']`,
)

describe('purity: the package is bundleable for a browser', () => {
  it('an esbuild browser bundle of the entry succeeds with no externals (zod is inlined)', async () => {
    const result = await bundle()
    expect(result.errors).toEqual([])
    expect(externalImports(result.metafile)).toEqual([])
    expect(result.outputFiles?.length).toBe(1)
  })

  it('the bundle contains no Node builtin: not as an input, an import, or a require', async () => {
    const result = await bundle()
    const inputs = bundledInputs(result.metafile)
    expect(inputs.filter((p) => p.startsWith('node:'))).toEqual([])
    expect(inputs.some((p) => /(^|[\\/])node:/.test(p))).toBe(false)
    const code = result.outputFiles?.[0]?.text ?? ''
    expect(BUILTIN_RE.test(code)).toBe(false)
    // and nothing in the bundle reaches for the Node-only globals the lint rule forbids
    expect(/\bprocess\.(?:env|versions|platform)\b/.test(code)).toBe(false)
    expect(/\bBuffer\.from\b/.test(code)).toBe(false)
  })

  it('does not use crypto.subtle or crypto.randomUUID (unavailable on http://<LAN-IP>)', async () => {
    const code = (await bundle()).outputFiles?.[0]?.text ?? ''
    expect(/crypto\s*\.\s*(?:subtle|randomUUID)/.test(code)).toBe(false)
  })
})

describe('purity: a Node import inside the package is rejected by both guards', () => {
  const scratch = "import { createHash } from 'node:crypto'\nexport const h = createHash\n"

  it('esbuild (platform browser) cannot bundle it', async () => {
    await expect(bundleSnippet(scratch)).rejects.toThrow(/node:crypto/)
  })

  it('a bare builtin name is rejected by esbuild too', async () => {
    await expect(bundleSnippet("import fs from 'fs'\nexport const x = fs\n")).rejects.toThrow(/fs/)
  })

  it('ESLint reports no-restricted-imports for it in a file under packages/schema-core', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT })
    const [res] = await eslint.lintText(scratch, {
      filePath: `${SRC_DIR}/__scratch__.ts`,
    })
    const rules = (res?.messages ?? []).map((m) => m.ruleId)
    expect(rules).toContain('no-restricted-imports')
  })

  it('ESLint also rejects Buffer, process and crypto.subtle in the package', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT })
    const [res] = await eslint.lintText(
      "export const a = Buffer.from('x')\nexport const b = process.env\nexport const c = crypto.subtle\n",
      { filePath: `${SRC_DIR}/__scratch2__.ts` },
    )
    const rules = (res?.messages ?? []).map((m) => m.ruleId)
    expect(rules).toContain('no-restricted-globals')
    expect(rules).toContain('no-restricted-syntax')
  })

  it('the real source files lint clean under the purity rules', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT })
    const results = await eslint.lintFiles([`${SRC_DIR}/**/*.ts`])
    const restricted = results.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId?.startsWith('no-restricted'))
        .map((m) => `${r.filePath}: ${m.message}`),
    )
    expect(restricted).toEqual([])
  })
})
