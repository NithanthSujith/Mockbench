import { describe, expect, it } from 'vitest'
import pkg from '../package.json'
import { bundleSnippet, measure } from './bundle'

const ZOD_EXTERNAL = { external: ['zod', 'zod/*'] }
const limit = pkg.sizeLimit

/**
 * Size budgets (minified + gzipped bytes) for the browser bundle, measured with esbuild and the
 * web-standard CompressionStream. `sizeLimit` in package.json holds the committed budgets (measured
 * size + about 10%): raising one is a deliberate act that shows up in review.
 *
 * Measured when the budgets were set (FND-05): full bundle 101,601 B with zod and 8,275 B without it;
 * validateSchema alone 2,260 B; generate alone 5,508 B; the browser preview path (validateSchema +
 * generate + buildPresetResolver) 5,986 B, with no zod in it. Classic zod by itself is about 93 KB gzipped,
 * so the package's own code is under a tenth of the total.
 */
describe('size budget', () => {
  it('the package code without zod fits its budget', async () => {
    const { gzip } = await measure(undefined, ZOD_EXTERNAL)
    expect(gzip).toBeLessThanOrEqual(limit.gzipBytesExcludingZod)
  })

  it('the whole bundle including zod fits its budget (catches a zod upgrade that balloons)', async () => {
    const { gzip } = await measure(undefined)
    expect(gzip).toBeLessThanOrEqual(limit.gzipBytesIncludingZod)
  })

  it('importing only validateSchema stays small', async () => {
    const { gzip } = await measure("export { validateSchema } from './index'")
    expect(gzip).toBeLessThanOrEqual(limit.gzipBytesValidateOnly)
  })

  it('the browser preview path (validateSchema + generate + buildPresetResolver) stays small', async () => {
    const { gzip } = await measure(
      "export { validateSchema, generate, buildPresetResolver } from './index'",
    )
    expect(gzip).toBeLessThanOrEqual(limit.gzipBytesPreviewPath)
  })

  it('importing only generate stays small', async () => {
    const { gzip } = await measure("export { generate } from './index'")
    expect(gzip).toBeLessThanOrEqual(limit.gzipBytesGenerateOnly)
  })
})

describe('tree-shaking: the browser preview path does not need zod', () => {
  // The metafile also lists modules esbuild parsed and then dropped, so count only bytes that reach the output.
  const zodInputs = async (snippet: string) => {
    const result = await bundleSnippet(snippet)
    return Object.values(result.metafile.outputs).flatMap((o) =>
      Object.entries(o.inputs)
        .filter(([p, v]) => /[\\/]zod[\\/]/.test(p) && v.bytesInOutput > 0)
        .map(([p]) => p),
    )
  }

  it('validateSchema, generate, inferSchema and sha1 pull in no zod code', async () => {
    for (const name of [
      'validateSchema',
      'generate',
      'inferSchema',
      'sha1',
      'buildPresetResolver',
    ]) {
      expect(await zodInputs(`export { ${name} } from './index'`), name).toEqual([])
    }
  })

  it('the zod schemas do pull zod in (so the check above is meaningful)', async () => {
    expect((await zodInputs("export { mockSchemaZod } from './index'")).length).toBeGreaterThan(0)
    expect((await zodInputs("export { PresetRuleSchema } from './index'")).length).toBeGreaterThan(
      0,
    )
  })

  it('package.json declares sideEffects:false, which is what lets bundlers drop unused modules', () => {
    expect(pkg.sideEffects).toBe(false)
  })
})
