import { z } from 'zod'
import { NODE_TYPES } from './types'
import type { FieldEntry, Json, MockNode, MockSchema } from './types'

/**
 * Structural Zod schemas for MockSchema, for consumers that want a Zod type (api-contract, forms).
 * Nodes are `looseObject`s: unknown keys are preserved and ignored.
 *
 * `validateSchema` is the authoritative validator (limits, refs, duplicate keys, issue codes);
 * these schemas cover shape only and must accept everything `validateSchema` accepts.
 */
const jsonZod = z.json() as unknown as z.ZodType<Json>

export const fieldEntryZod: z.ZodType<FieldEntry> = z.lazy(() =>
  z.looseObject({ key: z.string(), node: mockNodeZod }),
) as unknown as z.ZodType<FieldEntry>

export const mockNodeZod: z.ZodType<MockNode> = z.lazy(() =>
  z.looseObject({
    type: z.enum(NODE_TYPES),
    nullable: z.boolean().optional(),
    description: z.string().optional(),
    fixed: jsonZod.optional(),
    examples: z.array(jsonZod).optional(),
    source: z.unknown().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    fields: z.array(fieldEntryZod).optional(),
    items: mockNodeZod.optional(),
    count: z.number().int().optional(),
    name: z.string().optional(),
  }),
) as unknown as z.ZodType<MockNode>

export const mockSchemaZod: z.ZodType<MockSchema> = z.looseObject({
  version: z.literal(1),
  components: z.record(z.string(), mockNodeZod),
  root: mockNodeZod,
}) as unknown as z.ZodType<MockSchema>
