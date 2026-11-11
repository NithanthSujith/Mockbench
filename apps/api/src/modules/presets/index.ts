// Module "presets" (PRJ-02): the Preset resource of API-CONTRACT 3.5. Rule validation happens at the
// edge from the registry (`PresetRulesSchema` of schema-core); handlers only persist.
import type { Preset } from '@mockbench/api-contract'
import { asc, desc, eq } from 'drizzle-orm'
import { loadPresetForUser, loadProjectForUser } from '../../access'
import { dataPresets } from '../../db/schema'
import { authOf } from '../../http/auth'
import type { ModuleHandlers } from '../../http/types'

export const areas = ['presets'] as const

type Row = typeof dataPresets.$inferSelect

function toPreset(row: Row): Preset {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    rules: row.rules as Preset['rules'],
    isEnabled: row.isEnabled,
    priority: row.priority,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}

export const handlers: ModuleHandlers<'presets'> = {
  'presets.list': async (ctx, { params }) => {
    await loadProjectForUser(ctx.db, authOf(ctx).userId, params.projectId, 'viewer')
    const rows = await ctx.db
      .select()
      .from(dataPresets)
      .where(eq(dataPresets.projectId, params.projectId))
      .orderBy(desc(dataPresets.priority), asc(dataPresets.createdAt), asc(dataPresets.id))
    return { status: 200, body: { items: rows.map(toPreset), nextCursor: null } }
  },

  'presets.create': async (ctx, { params, body }) => {
    await loadProjectForUser(ctx.db, authOf(ctx).userId, params.projectId, 'editor')
    const [row] = await ctx.db
      .insert(dataPresets)
      .values({
        projectId: params.projectId,
        name: body.name,
        rules: body.rules,
        isEnabled: body.isEnabled ?? true,
        priority: body.priority ?? 0,
      })
      .returning()
    return { status: 201, body: toPreset(row!) }
  },

  'presets.update': async (ctx, { params, body }) => {
    const { entity } = await loadPresetForUser(
      ctx.db,
      authOf(ctx).userId,
      params.presetId,
      'editor',
    )
    const set: Partial<typeof dataPresets.$inferInsert> = {}
    if (body.name !== undefined) set.name = body.name
    if (body.rules !== undefined) set.rules = body.rules
    if (body.isEnabled !== undefined) set.isEnabled = body.isEnabled
    if (body.priority !== undefined) set.priority = body.priority
    if (Object.keys(set).length === 0) return { status: 200, body: toPreset(entity) }
    const [row] = await ctx.db
      .update(dataPresets)
      .set(set)
      .where(eq(dataPresets.id, entity.id))
      .returning()
    return { status: 200, body: toPreset(row!) }
  },

  'presets.delete': async (ctx, { params }) => {
    await loadPresetForUser(ctx.db, authOf(ctx).userId, params.presetId, 'editor')
    await ctx.db.delete(dataPresets).where(eq(dataPresets.id, params.presetId))
    return { status: 204 }
  },
}
