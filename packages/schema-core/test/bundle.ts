import { build } from 'esbuild'
import type { BuildOptions, Metafile } from 'esbuild'
import { resolveFromModule } from './helpers'

export const SRC_DIR = resolveFromModule(import.meta.url, '../src')
export const ENTRY = `${SRC_DIR}/index.ts`
export const REPO_ROOT = resolveFromModule(import.meta.url, '../../..')

/** How the package is bundled for a browser: platform browser, everything inlined, nothing external. */
export const browserBuild = (over: BuildOptions = {}): BuildOptions => ({
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  write: false,
  metafile: true,
  logLevel: 'silent',
  external: [],
  ...over,
})

/** esbuild always returns the metafile we ask for; this narrows the type once instead of in every test. */
async function run(options: BuildOptions) {
  const r = await build(options)
  if (!r.metafile) throw new Error('esbuild returned no metafile')
  return { ...r, metafile: r.metafile }
}

export const bundle = (over: BuildOptions = {}) =>
  run(browserBuild({ entryPoints: [ENTRY], ...over }))

/** Bundles a snippet that imports from the package (resolved relative to src/). */
export function bundleSnippet(contents: string, over: BuildOptions = {}) {
  return run(
    browserBuild({
      entryPoints: undefined,
      stdin: { contents, resolveDir: SRC_DIR, loader: 'ts', sourcefile: 'snippet.ts' },
      ...over,
    }),
  )
}

export const NODE_BUILTINS = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'tls',
  'url',
  'util',
  'vm',
  'worker_threads',
  'zlib',
]

/** Paths of everything the bundle inlined, plus anything it left as an external import. */
export function bundledInputs(metafile: Metafile): string[] {
  return Object.keys(metafile.inputs)
}
export function externalImports(metafile: Metafile): string[] {
  return Object.values(metafile.outputs).flatMap((o) => o.imports.map((i) => i.path))
}

/** Minified and gzipped size in bytes, measured with the web-standard CompressionStream. */
export async function gzipSize(code: string): Promise<{ min: number; gzip: number }> {
  const bytes = new TextEncoder().encode(code)
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  const gz = await new Response(stream).arrayBuffer()
  return { min: bytes.length, gzip: gz.byteLength }
}

export async function measure(contents: string | undefined, over: BuildOptions = {}) {
  const result =
    contents === undefined
      ? await bundle({ minify: true, ...over })
      : await bundleSnippet(contents, { minify: true, ...over })
  const out = result.outputFiles?.[0]?.text ?? ''
  return gzipSize(out)
}
