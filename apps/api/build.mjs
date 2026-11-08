// Production build (FND-10 decision, replaces `tsc --noEmit` as the build step; typecheck stays tsc).
//   dist/server.js   the api
//   dist/migrate.js  the migration entry the container runs before the server
//   dist/migrations  the SQL migrations next to migrate.js
// @mockbench/* workspace packages (TypeScript source) are INLINED; every other npm dependency stays
// external and is loaded from node_modules at runtime (the image copies production node_modules).
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = dirname(fileURLToPath(import.meta.url))

/** Builds into `outdir` (default ./dist). Exported so tests can build into a scratch folder. */
export async function buildApi({ outdir = resolve(root, 'dist') } = {}) {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const external = Object.keys(pkg.dependencies ?? {})
    .filter((name) => !name.startsWith('@mockbench/'))
    .flatMap((name) => [name, `${name}/*`])

  rmSync(outdir, { recursive: true, force: true })
  mkdirSync(outdir, { recursive: true })
  await build({
    absWorkingDir: root,
    entryPoints: { server: 'src/server.ts', migrate: 'src/bin/migrate.ts' },
    outdir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    external,
    // Lets bundled CommonJS-style code that calls require() keep working inside an ES module.
    banner: {
      js: "import { createRequire as __mbCreateRequire } from 'node:module'; const require = __mbCreateRequire(import.meta.url);",
    },
    logLevel: 'warning',
  })
  cpSync(resolve(root, 'src/db/migrations'), resolve(outdir, 'migrations'), { recursive: true })
  return outdir
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outdir = await buildApi()
  console.log(`api built -> ${outdir}`)
}
