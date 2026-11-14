// REL-01 documentation checks, shared by scripts/docs-check.test.ts (which `pnpm test` and CI run).
//   - every variable the api reads or .env.example lists is in the docs env table
//   - every relative link in README.md and docs/site/** resolves to a file
//   - nothing in README.md or docs/site/** pulls an external asset (script, stylesheet, image, font)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const ENV_DOC = 'docs/site/environment-variables.md'

const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/** Variables named in .env.example, commented-out ones included. */
export function envExampleVars() {
  const names = new Set()
  for (const line of read('.env.example').split('\n')) {
    const m = /^#?\s*([A-Z][A-Z0-9_]+)=/.exec(line)
    if (m) names.add(m[1])
  }
  return [...names].sort()
}

/** Variables the api reads, taken from the helper calls in apps/api/src/config.ts. */
export function configVars() {
  const names = new Set()
  const src = read('apps/api/src/config.ts')
  for (const m of src.matchAll(/\b(?:raw|str|int|bool)\(\s*'([A-Z][A-Z0-9_]+)'/g)) names.add(m[1])
  return [...names].sort()
}

/** Variables documented in a table row of the env doc: a row starting with `| \`NAME\``. */
export function documentedVars() {
  const names = new Set()
  for (const line of read(ENV_DOC).split('\n')) {
    const m = /^\|\s*`([A-Z][A-Z0-9_]+)`/.exec(line)
    if (m) names.add(m[1])
  }
  return names
}

export function undocumentedVars() {
  const documented = documentedVars()
  return [...new Set([...envExampleVars(), ...configVars()])]
    .filter((v) => !documented.has(v))
    .sort()
}

export function docFiles() {
  const out = ['README.md', 'examples/README.md']
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel)
      else if (name.endsWith('.md')) out.push(rel)
    }
  }
  walk('docs/site')
  return out.filter((f) => existsSync(join(ROOT, f)))
}

const stripCode = (text) => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')

/** Relative links (not http, mailto or pure anchors) that do not resolve to a file or directory. */
export function brokenLinks() {
  const broken = []
  for (const file of docFiles()) {
    const text = stripCode(read(file))
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1]
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const path = target.split('#')[0]
      if (!path) continue
      if (!existsSync(resolve(ROOT, dirname(file), path))) broken.push(`${file}: ${target}`)
    }
  }
  return broken
}

/** External assets: images, scripts, stylesheets and fonts loaded from a URL, in any of the docs. */
export function externalAssets() {
  const found = []
  for (const file of docFiles()) {
    const text = stripCode(read(file))
    for (const m of text.matchAll(/!\[[^\]]*\]\((https?:[^)\s]+)\)/g))
      found.push(`${file}: image ${m[1]}`)
    for (const m of text.matchAll(/<(script|link|img|iframe|source|video|audio)\b[^>]*>/gi)) {
      if (/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i.test(m[0])) found.push(`${file}: ${m[0]}`)
    }
  }
  return found
}
