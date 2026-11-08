// Wiring of the endpoint registry to module handlers (shared, main-session-only file).
// Each module directory owns the endpoint areas (id prefixes) it declares; adding a handler is done
// inside the module's own index.ts, never here.
import type { ModuleDefinition } from '../http/types'
import * as auth from './auth'
import * as cases from './cases'
import * as presets from './presets'
import * as projects from './projects'
import * as requests from './requests'
import * as routes from './routes'
import * as schema from './schema'
import * as system from './system'
import * as versions from './versions'
import * as workspaces from './workspaces'

export const modules = {
  auth,
  workspaces,
  projects,
  presets,
  routes,
  cases,
  schema,
  versions,
  requests,
  system,
} satisfies Record<string, ModuleDefinition>

export type ModuleMap = Readonly<Record<string, ModuleDefinition>>
