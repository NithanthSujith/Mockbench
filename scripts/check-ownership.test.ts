import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs script without type declarations
import { checkOwnership, loadConfig } from './check-ownership.mjs'

const config = loadConfig()
const script = fileURLToPath(new URL('./check-ownership.mjs', import.meta.url))

function cli(branch: string, ...files: string[]) {
  return spawnSync(process.execPath, [script, branch, ...files], { encoding: 'utf8' })
}

describe('check-ownership (library)', () => {
  it('rejects a team editing the Drizzle schema', () => {
    const r = checkOwnership('team/auth/AUTH-01', ['apps/api/src/db/schema.ts'], config)
    expect(r.ok).toBe(false)
    expect(r.violations).toEqual(['apps/api/src/db/schema.ts'])
  })
  it('accepts a team editing its own module and its own spec', () => {
    const r = checkOwnership(
      'team/auth/AUTH-01',
      ['apps/api/src/modules/auth/x.ts', 'docs/specs/AUTH-01-session-core.md'],
      config,
    )
    expect(r.ok).toBe(true)
  })
  it("rejects a team editing another team's module", () => {
    const r = checkOwnership('team/builder/BLD-01', ['apps/api/src/modules/auth/x.ts'], config)
    expect(r.ok).toBe(false)
  })
  it("rejects a team editing a different unit's spec", () => {
    const r = checkOwnership('team/auth/AUTH-01', ['docs/specs/AUTH-02-auth-endpoints.md'], config)
    expect(r.ok).toBe(false)
  })
  it('lets any team touch the lockfile and per-app manifests but not the root manifest', () => {
    expect(
      checkOwnership('team/runtime/RUN-01', ['pnpm-lock.yaml', 'apps/api/package.json'], config).ok,
    ).toBe(true)
    expect(checkOwnership('team/runtime/RUN-01', ['package.json'], config).ok).toBe(false)
    expect(checkOwnership('team/runtime/RUN-01', ['pnpm-workspace.yaml'], config).ok).toBe(false)
  })
  it('lets a team add e2e specs under its own folder only', () => {
    expect(
      checkOwnership('team/builder/BLD-05', ['e2e/builder/route-editor.spec.ts'], config).ok,
    ).toBe(true)
    expect(checkOwnership('team/builder/BLD-05', ['e2e/auth/login.spec.ts'], config).ok).toBe(false)
  })
  it('does not constrain non-team branches or core', () => {
    expect(checkOwnership('feature/whatever', ['package.json'], config).ok).toBe(true)
    expect(
      checkOwnership('team/core/FND-02', ['packages/schema-core/src/index.ts'], config).ok,
    ).toBe(true)
    expect(checkOwnership('main', ['package.json'], config).ok).toBe(true)
  })
  it('rejects an unknown team', () => {
    expect(checkOwnership('team/ghost/GHO-01', ['x'], config).ok).toBe(false)
  })
  it('normalises Windows path separators', () => {
    expect(checkOwnership('team/auth/AUTH-01', ['apps\\api\\src\\db\\schema.ts'], config).ok).toBe(
      false,
    )
  })
})

describe('check-ownership (CLI exit codes)', () => {
  it('exits 1 for team/auth/AUTH-01 editing apps/api/src/db/schema.ts', () => {
    expect(cli('team/auth/AUTH-01', 'apps/api/src/db/schema.ts').status).toBe(1)
  })
  it('exits 0 for its own module and spec', () => {
    expect(
      cli(
        'team/auth/AUTH-01',
        'apps/api/src/modules/auth/x.ts',
        'docs/specs/AUTH-01-session-core.md',
      ).status,
    ).toBe(0)
  })
  it('exits 1 for team/builder/BLD-01 editing the auth module', () => {
    expect(cli('team/builder/BLD-01', 'apps/api/src/modules/auth/x.ts').status).toBe(1)
  })
  it('exits 0 for a non-team branch', () => {
    expect(cli('main', 'package.json').status).toBe(0)
  })
})
