// BLD-03: the two stateless schema helper endpoints. Thin wrappers over schema-core; no database.
import {
  GENERATOR_VERSION,
  GenerationLimitError,
  SchemaInvalidError,
  buildPresetResolver,
  generate,
  inferSchema,
  validateSchema,
} from '@mockbench/schema-core'
import type { Issue, MockNode } from '@mockbench/schema-core'
import { HttpError } from '../../http/errors'
import type { ModuleHandlers } from '../../http/types'

/** The id used for UUID v5 generation when the caller sends no `projectId` (API-CONTRACT 3.8). */
export const NIL_PROJECT_ID = '00000000-0000-0000-0000-000000000000'

/** One entry of a 422 `details` list. */
interface DetailIssue {
  path: (string | number)[]
  code: string
  message: string
}

/** schema-core issues are relative to the schema; the request body nests it under `schema`. */
const underSchema = (issues: Issue[]): DetailIssue[] =>
  issues.map((i) => ({ path: ['schema', ...i.path], code: i.code, message: i.message }))

/**
 * `inferSchema` reports a sample that is over a size limit as ONE `limits_exceeded` warning whose
 * message names the limit (and returns an empty schema). The contract wants a 422 with the specific
 * issue code, so the code is recovered from that wording. Pinned by tests against schema-core's
 * messages: if the wording changes, those tests fail rather than the code silently becoming wrong.
 */
export function limitIssueCode(message: string): string {
  if (/nested more than/.test(message) || /deeper than/.test(message)) return 'depth_exceeded'
  if (/array longer than/.test(message)) return 'array_count_exceeded'
  if (/more than [\d,]+ values/.test(message)) return 'leaf_limit_exceeded'
  return 'node_limit_exceeded'
}

export const handlers: ModuleHandlers<'schema'> = {
  'schema.infer': async (_ctx, { body }) => {
    const result = inferSchema(body.sample)
    const breach = result.warnings.find((w) => w.code === 'limits_exceeded')
    if (breach) {
      throw new HttpError(
        422,
        'validation_failed',
        'The sample is too large to infer a schema from.',
        [{ path: ['sample'], code: limitIssueCode(breach.message), message: breach.message }],
      )
    }
    return { status: 200, body: { schema: result.schema, warnings: result.warnings } }
  },

  'schema.preview': async (_ctx, { body }) => {
    const components = body.components as Record<string, MockNode> | undefined
    // Authoritative validation (limits, refs, cycles, duplicate keys). The request schema is structural only.
    const checked = validateSchema(body.schema, components ? { components } : undefined)
    if (!checked.ok) {
      throw new HttpError(
        422,
        'validation_failed',
        'The schema is not valid.',
        underSchema(checked.issues),
      )
    }

    const presets = body.presets?.map((p) => ({ priority: p.priority ?? 0, rules: p.rules }))
    try {
      const out = generate(
        body.schema,
        {
          projectId: body.projectId ?? NIL_PROJECT_ID,
          settings: {
            indexing: body.settings?.indexing ?? 'local',
            mode: body.settings?.mode ?? 'deterministic',
          },
          ...(components ? { components } : {}),
          ...(presets?.length ? { presets: buildPresetResolver(presets) } : {}),
        },
        { indent: 2 },
      )
      return { status: 200, body: { json: out.json, generatorVersion: GENERATOR_VERSION } }
    } catch (err) {
      // validateSchema passed, so this should be unreachable; never let it become a 500.
      if (err instanceof GenerationLimitError) {
        throw new HttpError(422, 'validation_failed', 'The schema is over a size limit.', [
          { path: ['schema'], code: err.code, message: err.message },
        ])
      }
      if (err instanceof SchemaInvalidError) {
        throw new HttpError(
          422,
          'validation_failed',
          'The schema is not valid.',
          underSchema(err.issues),
        )
      }
      throw err
    }
  },
}
