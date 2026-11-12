import {
  GenerationLimitError,
  LIMITS,
  SchemaInvalidError,
  buildPresetResolver,
  generate,
  validateSchema,
  type Issue,
  type MockNode,
  type MockSchema,
  type Provenance,
  type ResolvedPreset,
} from '@mockbench/schema-core'

export type PreviewSettings = {
  indexing: 'local' | 'path'
  mode: 'deterministic' | 'seeded' | 'random'
}

export type PreviewInput = {
  schema: unknown
  projectId: string
  settings: PreviewSettings
  components: Record<string, MockNode>
  presets: readonly ResolvedPreset[]
}

export type PreviewResult =
  | { kind: 'ok'; json: string; provenance: Record<string, Provenance> }
  | { kind: 'invalid'; issues: Issue[] }
  | { kind: 'too-large'; limit: number }

/**
 * The exact body the server bakes for this schema: schema-core runs locally with the project's
 * settings, components and enabled presets, pretty-printed with 2 spaces. Never throws; the
 * generator checks limits before it allocates, so an oversized schema cannot freeze the tab.
 */
export function computePreview(input: PreviewInput): PreviewResult {
  const checked = validateSchema(input.schema, { components: input.components })
  if (!checked.ok) {
    return checked.issues.some((i) => i.code === 'leaf_limit_exceeded')
      ? { kind: 'too-large', limit: LIMITS.maxLeaves }
      : { kind: 'invalid', issues: checked.issues }
  }
  try {
    const result = generate(
      input.schema as MockSchema,
      {
        projectId: input.projectId,
        settings: input.settings,
        components: input.components,
        presets: buildPresetResolver(input.presets),
      },
      { indent: 2 },
    )
    return { kind: 'ok', json: result.json, provenance: result.provenance }
  } catch (error) {
    if (error instanceof GenerationLimitError) {
      return error.code === 'leaf_limit_exceeded'
        ? { kind: 'too-large', limit: LIMITS.maxLeaves }
        : { kind: 'invalid', issues: [{ path: [], code: error.code, message: error.message }] }
    }
    if (error instanceof SchemaInvalidError) return { kind: 'invalid', issues: error.issues }
    return {
      kind: 'invalid',
      issues: [{ path: [], code: 'invalid_type', message: 'The schema could not be generated.' }],
    }
  }
}
