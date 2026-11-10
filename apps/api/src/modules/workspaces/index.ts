// Module "workspaces": owns the endpoint areas below. Fill in `handlers` in your unit; the TYPE only
// admits ids of these areas, so binding another team's endpoint is a compile error.
import type { ModuleHandlers } from '../../http/types'
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
} from './workspaces'

export const areas = ['workspaces', 'members'] as const

export const handlers: ModuleHandlers<'workspaces' | 'members'> = {
  // WS-01. The members.* handlers are WS-02.
  'workspaces.list': (ctx) => listWorkspaces(ctx),
  'workspaces.create': (ctx, input) => createWorkspace(ctx, input),
  'workspaces.get': (ctx, input) => getWorkspace(ctx, input),
  'workspaces.update': (ctx, input) => updateWorkspace(ctx, input),
  'workspaces.delete': (ctx, input) => deleteWorkspace(ctx, input),
}
