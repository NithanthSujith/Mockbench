// Usage: node scripts/check-pr-title.mjs "<pr title>"
// The repository squash-merges, so the PR title becomes the commit on main; it must be a conventional
// commit (REL-03, ADR 0020). Branch commits are not checked.
import { fileURLToPath } from 'node:url'

export const TYPES = [
  'feat',
  'fix',
  'docs',
  'test',
  'refactor',
  'perf',
  'build',
  'ci',
  'chore',
  'style',
  'revert',
]

const TITLE = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9-/]*\\))?(!)?: (\\S.*)$`)

export function checkPrTitle(title) {
  const t = (title ?? '').trim()
  if (t.length > 100) return { ok: false, reason: `longer than 100 characters (${t.length})` }
  const m = TITLE.exec(t)
  if (!m) {
    return {
      ok: false,
      reason: `expected "<type>(<scope>): <subject>" with type one of ${TYPES.join(', ')}`,
    }
  }
  if (/\.$/.test(m[4])) return { ok: false, reason: 'the subject ends with a period' }
  return { ok: true, reason: '' }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const title = process.argv[2] ?? process.env.PR_TITLE
  const res = checkPrTitle(title)
  if (!res.ok) {
    console.error(`PR title is not a conventional commit: ${res.reason}`)
    console.error(`  title: ${JSON.stringify(title ?? '')}`)
    console.error(
      '  e.g.  feat(runtime): RUN-14 something   fix(builder): keep the case bar unique',
    )
    process.exit(1)
  }
  console.log('check-pr-title: ok')
}
