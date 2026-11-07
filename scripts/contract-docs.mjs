// `pnpm contract:docs [--check]` (FND-06).
//   (no flag)  print what the doc declares and how it compares with the registry; always exits 0.
//   --check    exit 1 on any drift or malformed doc row (CI mode).
// The registry lives in TypeScript (packages/api-contract/src), so it is loaded through Vite's SSR
// loader, which ships with vitest (no extra dependency). FND-07 must export it as `registry` from the
// package's main entry. Until then `--check` fails closed with a clear message (exit 1), and the
// plain run just reports the doc's endpoint count.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { compareContract, formatReport, parseContractDoc } from './contract-docs-lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const check = process.argv.includes('--check')
const docPath = resolve(root, 'docs/API-CONTRACT.md')

async function loadRegistry() {
  const { createViteServer } = await import('vitest/node')
  const server = await createViteServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    const mod = await server.ssrLoadModule('/packages/api-contract/src/index.ts')
    return mod.registry ?? null
  } finally {
    await server.close()
  }
}

const parsed = parseContractDoc(readFileSync(docPath, 'utf8'))
console.log(
  `contract:docs - ${parsed.endpoints.length} endpoints declared in docs/API-CONTRACT.md section 3`,
)

const registry = await loadRegistry()
if (!registry) {
  const msg =
    'contract:docs - no `registry` export in @mockbench/api-contract yet (FND-07 defines the endpoints), so there is nothing to compare against.'
  if (check) {
    console.error(`${msg}\nFailing because --check was requested.`)
    if (parsed.problems.length)
      console.error(formatReport({ issues: [], problems: parsed.problems }))
    process.exit(1)
  }
  console.log(msg)
  process.exit(0)
}

const summary = registry.endpoints.map((e) => ({
  id: e.id,
  method: e.method,
  path: e.path,
  auth: e.auth,
  errors: e.errors,
  aliases: e.aliases ?? [],
}))
const issues = compareContract(parsed.endpoints, summary)
const total = issues.length + parsed.problems.length
if (total === 0) {
  console.log(`contract:docs - OK: registry (${summary.length} endpoints) matches the doc.`)
} else {
  console.error(
    `contract:docs - ${total} problem(s):\n${formatReport({ issues, problems: parsed.problems })}`,
  )
  if (check) process.exit(1)
}
