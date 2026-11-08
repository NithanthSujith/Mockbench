// Compile-time guarantee (FND-10 acceptance criterion): a module can only bind handlers for ITS OWN
// endpoint areas. This file is checked by `pnpm typecheck`; it is never imported or bundled.
// If binding another area's endpoint ever stops being a type error, the `@ts-expect-error` below
// becomes an "unused directive" error and the typecheck fails.
import type { ModuleHandlers } from '../../http/types'

// A handler for an endpoint the module owns is fine.
export const ownEndpoint: ModuleHandlers<'projects'> = {
  'projects.delete': async () => ({ status: 204 }),
}

export const otherAreasEndpoint: ModuleHandlers<'projects'> = {
  // @ts-expect-error 'auth.login' belongs to the auth module, not to projects
  'auth.login': async () => ({ status: 204 }),
}

// A module owning several areas may bind any of them.
export const severalAreas: ModuleHandlers<'workspaces' | 'members'> = {
  'members.remove': async () => ({ status: 204 }),
  'workspaces.delete': async () => ({ status: 204 }),
}

// The handler's own return type is checked against the contract: 418 is not a declared response.
export const wrongStatus: ModuleHandlers<'projects'> = {
  // @ts-expect-error projects.delete declares 204, not 418
  'projects.delete': async () => ({ status: 418 }),
}
