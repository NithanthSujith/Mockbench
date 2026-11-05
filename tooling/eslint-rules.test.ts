import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const eslint = new ESLint({ cwd: root })

async function rules(code: string, filePath: string): Promise<string[]> {
  const [res] = await eslint.lintText(code, { filePath: `${root}${filePath}` })
  return (res?.messages ?? []).map((m) => m.ruleId ?? 'parse-error')
}

describe('rule 1: schema-core and api-contract stay browser-safe', () => {
  const files = ['packages/schema-core/src/probe.ts', 'packages/api-contract/src/probe.ts']
  for (const file of files) {
    it(`rejects node:fs in ${file}`, async () => {
      expect(await rules("import fs from 'node:fs'\nexport const x = fs\n", file)).toContain(
        'no-restricted-imports',
      )
    })
    it(`rejects bare Node builtin imports in ${file}`, async () => {
      expect(
        await rules("import { createHash } from 'crypto'\nexport const x = createHash\n", file),
      ).toContain('no-restricted-imports')
      expect(
        await rules("import { readFile } from 'fs/promises'\nexport const x = readFile\n", file),
      ).toContain('no-restricted-imports')
    })
    it(`rejects Buffer and process in ${file}`, async () => {
      expect(await rules("export const b = Buffer.from('x')\n", file)).toContain(
        'no-restricted-globals',
      )
      expect(await rules('export const p = process.env\n', file)).toContain('no-restricted-globals')
    })
    it(`rejects crypto.subtle in ${file}`, async () => {
      expect(await rules('export const d = crypto.subtle.digest\n', file)).toContain(
        'no-restricted-syntax',
      )
    })
    it(`accepts pure code in ${file}`, async () => {
      expect(await rules('export const add = (a: number, b: number) => a + b\n', file)).toEqual([])
    })
  }
})

describe('rules 2-4: the web app', () => {
  const src = 'apps/web/src/features/auth/probe.ts'

  it('rejects a localhost literal (string and template)', async () => {
    expect(await rules("export const u = 'http://localhost:3000'\n", src)).toContain(
      'no-restricted-syntax',
    )
    expect(await rules('export const u = `http://127.0.0.1:${1}`\n', src)).toContain(
      'no-restricted-syntax',
    )
  })
  it('rejects colour literals', async () => {
    expect(await rules("export const c = '#fff'\n", src)).toContain('no-restricted-syntax')
    expect(await rules("export const c = 'rgb(0, 0, 0)'\n", src)).toContain('no-restricted-syntax')
    expect(await rules("export const c = 'hsl(10 20% 30%)'\n", src)).toContain(
      'no-restricted-syntax',
    )
  })
  it('rejects fetch outside lib/api', async () => {
    expect(await rules("export const r = fetch('/api/v1/x')\n", src)).toContain(
      'no-restricted-globals',
    )
  })
  it('allows colour literals in src/styles', async () => {
    expect(await rules("export const c = '#0C0F13'\n", 'apps/web/src/styles/tokens.ts')).toEqual([])
  })
  it('still rejects localhost in src/styles', async () => {
    expect(
      await rules("export const u = 'http://localhost'\n", 'apps/web/src/styles/tokens.ts'),
    ).toContain('no-restricted-syntax')
  })
  it('allows fetch inside lib/api', async () => {
    expect(
      await rules("export const r = fetch('/api/v1/x')\n", 'apps/web/src/lib/api/client.ts'),
    ).toEqual([])
  })
  it('exempts vite.config.ts (outside src) from the localhost rule', async () => {
    expect(
      await rules(
        "export default { target: 'http://127.0.0.1:3000' }\n",
        'apps/web/vite.config.ts',
      ),
    ).toEqual([])
  })
  it('accepts clean web code', async () => {
    expect(await rules("export const path = '/api/v1/projects'\n", src)).toEqual([])
  })
})
