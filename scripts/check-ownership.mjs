// Usage: node scripts/check-ownership.mjs <branch> <changed-file>...
// Exit 1 when a branch `team/<team>/<SPEC-ID>` changes files its team does not own (docs/TEAMS.md 2.1).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import picomatch from 'picomatch'

const BRANCH = /^team\/([a-z]+)\/([A-Z]+-\d+)(?:[/-].*)?$/

export function checkOwnership(branch, files, config) {
  const m = BRANCH.exec(branch)
  if (!m) return { ok: true, violations: [], note: 'not a team branch' }
  const [, team, id] = m
  if (team === 'core') return { ok: true, violations: [], note: 'core may change anything' }
  const owned = config.teams[team]
  if (!owned) return { ok: false, violations: [], note: `unknown team "${team}"` }
  const globs = [...owned, ...config.anyTeam, `docs/specs/${id}-*.md`, `e2e/${team}/**`]
  const isOwned = picomatch(globs, { dot: true })
  const violations = files.map((f) => f.replaceAll('\\', '/')).filter((f) => !isOwned(f))
  return { ok: violations.length === 0, violations, note: '' }
}

export function loadConfig(path = new URL('./ownership.json', import.meta.url)) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [branch, ...files] = process.argv.slice(2)
  if (!branch) {
    console.error('usage: check-ownership.mjs <branch> <changed-file>...')
    process.exit(2)
  }
  const res = checkOwnership(branch, files, loadConfig())
  if (!res.ok) {
    console.error(res.note || `Branch ${branch} changed files outside its team ownership:`)
    for (const v of res.violations) console.error(`  ${v}`)
    console.error('See docs/TEAMS.md 2.1: raise shared-file changes with the main session instead.')
    process.exit(1)
  }
}
