import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs script without type declarations
import { checkChangeset, parseLabels } from './check-changeset.mjs'
// @ts-expect-error plain .mjs script without type declarations
import { checkPrTitle } from './check-pr-title.mjs'

const titleScript = fileURLToPath(new URL('./check-pr-title.mjs', import.meta.url))
const changesetScript = fileURLToPath(new URL('./check-changeset.mjs', import.meta.url))

describe('check-pr-title', () => {
  it.each([
    'feat(builder): BLD-10 advanced attributes and components',
    'fix(projects): imported presets start disabled; docs: update STATUS.md',
    'docs: update STATUS.md (2026-11-12)',
    'test(e2e): XC-01 first-release end-to-end loop',
    'feat(api)!: drop the v0 endpoints',
    'ci: pin actions',
  ])('accepts %s', (t) => {
    expect(checkPrTitle(t).ok).toBe(true)
  })

  it.each([
    ['Update README', 'expected'],
    ['feature(builder): x', 'expected'],
    ['feat(Builder): x', 'expected'],
    ['feat: ', 'expected'],
    ['feat:missing space', 'expected'],
    ['fix: ends with a period.', 'period'],
    [`feat: ${'x'.repeat(100)}`, 'longer'],
  ])('rejects %s', (t, reason) => {
    const r = checkPrTitle(t)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain(reason)
  })

  it('exits 1 with a reason from the CLI, 0 for a good title', () => {
    const bad = spawnSync(process.execPath, [titleScript, 'WIP stuff'], { encoding: 'utf8' })
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('not a conventional commit')
    const good = spawnSync(process.execPath, [titleScript, 'fix(runtime): x'], { encoding: 'utf8' })
    expect(good.status).toBe(0)
  })
})

describe('check-changeset', () => {
  it('fails a PR that changes shipped code without a changeset', () => {
    const r = checkChangeset(['apps/api/src/modules/auth/auth.ts', 'docs/STATUS.md'])
    expect(r.ok).toBe(false)
    expect(r.shipped).toEqual(['apps/api/src/modules/auth/auth.ts'])
  })

  it('passes with a changeset file, or with the no-changeset label', () => {
    expect(checkChangeset(['packages/schema-core/src/x.ts', '.changeset/brave-owls.md']).ok).toBe(
      true,
    )
    expect(checkChangeset(['apps/web/src/main.tsx'], ['no-changeset']).ok).toBe(true)
  })

  it('does not count the changesets README as a changeset', () => {
    expect(checkChangeset(['apps/web/src/main.tsx', '.changeset/README.md']).ok).toBe(false)
  })

  it.each([
    ['docs only', ['docs/DESIGN.md', 'README.md']],
    ['tests only', ['apps/api/src/__tests__/config.test.ts', 'apps/web/src/hygiene.test.ts']],
    [
      'fixtures and harness',
      ['apps/api/src/modules/__fixtures__/a.ts', 'apps/api/src/testing/db.ts'],
    ],
    ['tooling', ['.github/workflows/ci.yml', 'scripts/x.mjs', 'e2e/first-release.spec.ts']],
    ['private tsconfig package', ['packages/tsconfig/base.json']],
  ])('needs nothing for %s', (_name, files) => {
    expect(checkChangeset(files).ok).toBe(true)
  })

  it('normalises Windows separators', () => {
    expect(checkChangeset(['apps\\api\\src\\app.ts']).ok).toBe(false)
  })

  it('parses labels as a JSON array or a comma list', () => {
    expect(parseLabels('["a","no-changeset"]')).toEqual(['a', 'no-changeset'])
    expect(parseLabels('a, no-changeset')).toEqual(['a', 'no-changeset'])
    expect(parseLabels(undefined)).toEqual([])
  })

  it('reads the file list with --from, so one run sees every changed file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'changeset-'))
    const list = join(dir, 'changed.txt')
    writeFileSync(list, 'apps/api/src/app.ts\r\n.changeset/brave-owls.md\n\n')
    const r = spawnSync(process.execPath, [changesetScript, '--from', list], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('changeset added')
  })

  it('exits 1 from the CLI and names the label', () => {
    const r = spawnSync(process.execPath, [changesetScript, 'apps/api/src/app.ts'], {
      encoding: 'utf8',
      env: { ...process.env, PR_LABELS: '[]' },
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('no-changeset')
  })
})
