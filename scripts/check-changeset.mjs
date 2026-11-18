// Usage: PR_LABELS='["a","b"]' node scripts/check-changeset.mjs <changed-file>...
//        PR_LABELS=... node scripts/check-changeset.mjs --from changed.txt   (one path per line)
// Exit 1 when a PR changes what ships without adding a changeset or carrying the `no-changeset` label
// (REL-03, ADR 0020). "What ships" is non-test, non-doc files in the four packages of the fixed group.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import picomatch from 'picomatch'

export const SHIPPED = [
  'apps/api/**',
  'apps/web/**',
  'packages/schema-core/**',
  'packages/api-contract/**',
]

export const NOT_SHIPPED = [
  '**/__tests__/**',
  '**/__fixtures__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.md',
  '**/vitest.config.*',
  '**/test-*.mjs',
  '**/test-setup.*',
  'apps/api/src/testing/**',
  'apps/web/src/mocks/**',
]

export const NO_CHANGESET_LABEL = 'no-changeset'

const isShippedPath = picomatch(SHIPPED, { dot: true })
const isNotShipped = picomatch(NOT_SHIPPED, { dot: true })
const isChangeset = (f) => /^\.changeset\/[^/]+\.md$/.test(f) && f !== '.changeset/README.md'

export function checkChangeset(files, labels = []) {
  const norm = files.map((f) => f.replaceAll('\\', '/'))
  const shipped = norm.filter((f) => isShippedPath(f) && !isNotShipped(f))
  if (shipped.length === 0) return { ok: true, shipped, note: 'nothing shipped changed' }
  if (norm.some(isChangeset)) return { ok: true, shipped, note: 'changeset added' }
  if (labels.includes(NO_CHANGESET_LABEL)) return { ok: true, shipped, note: 'no-changeset label' }
  return { ok: false, shipped, note: '' }
}

export function parseLabels(raw) {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
}

export function readFileList(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const files = args[0] === '--from' ? readFileList(args[1]) : args
  const res = checkChangeset(files, parseLabels(process.env.PR_LABELS))
  if (!res.ok) {
    console.error('This PR changes what ships but adds no changeset:')
    for (const f of res.shipped.slice(0, 20)) console.error(`  ${f}`)
    if (res.shipped.length > 20) console.error(`  ... and ${res.shipped.length - 20} more`)
    console.error(
      `Run \`pnpm changeset\` and commit the file, or add the \`${NO_CHANGESET_LABEL}\` label (.changeset/README.md).`,
    )
    process.exit(1)
  }
  console.log(`check-changeset: ok (${res.note})`)
}
