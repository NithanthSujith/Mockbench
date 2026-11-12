import type { Project, ProjectSettings } from '@mockbench/api-contract'

export interface SettingsValues {
  name: string
  description: string
  mode: ProjectSettings['mode']
  indexing: ProjectSettings['indexing']
  cors: ProjectSettings['cors']
  /** Text, so a half-typed or invalid number can be shown and rejected. */
  defaultDelay: string
}

export const DELAY_MESSAGE = 'Enter a whole number from 0 to 10000.'

export function valuesFromProject(project: Project): SettingsValues {
  return {
    name: project.name,
    description: project.description ?? '',
    mode: project.settings.mode,
    indexing: project.settings.indexing,
    cors: project.settings.cors,
    defaultDelay: String(project.settings.defaultDelayMs),
  }
}

export function delayProblem(text: string): string | undefined {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return DELAY_MESSAGE
  const n = Number(trimmed)
  return n >= 0 && n <= 10000 ? undefined : DELAY_MESSAGE
}

export function nameProblem(text: string): string | undefined {
  const n = text.trim().length
  if (n === 0) return 'A name is required.'
  if (n > 80) return 'Use 80 characters or fewer.'
  return undefined
}

export function descriptionProblem(text: string): string | undefined {
  return text.trim().length > 500 ? 'Use 500 characters or fewer.' : undefined
}

export type SettingsPatch = {
  name?: string
  description?: string | null
  settings?: Partial<ProjectSettings>
}

/** Only the keys that differ from the saved project. An empty object means nothing to save. */
export function diffToPatch(project: Project, v: SettingsValues): SettingsPatch {
  const patch: SettingsPatch = {}
  const name = v.name.trim()
  if (name !== project.name) patch.name = name
  const description = v.description.trim()
  if (description !== (project.description ?? '')) patch.description = description || null
  const settings: Partial<ProjectSettings> = {}
  if (v.mode !== project.settings.mode) settings.mode = v.mode
  if (v.indexing !== project.settings.indexing) settings.indexing = v.indexing
  if (v.cors !== project.settings.cors) settings.cors = v.cors
  const delay = Number(v.defaultDelay.trim())
  if (delay !== project.settings.defaultDelayMs) settings.defaultDelayMs = delay
  if (Object.keys(settings).length > 0) patch.settings = settings
  return patch
}
