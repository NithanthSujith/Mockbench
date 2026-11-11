// Module "workspaces": owns the endpoint areas below. Fill in `handlers` in your unit; the TYPE only
// admits ids of these areas, so binding another team's endpoint is a compile error.
import type { ModuleHandlers } from '../../http/types'
import { addMember, listMembers, removeMember, updateMember } from './members'
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
} from './workspaces'

export const areas = ['workspaces', 'members'] as const

export const handlers: ModuleHandlers<'workspaces' | 'members'> = {
  // WS-01
  'workspaces.list': (ctx) => listWorkspaces(ctx),
  'workspaces.create': (ctx, input) => createWorkspace(ctx, input),
  'workspaces.get': (ctx, input) => getWorkspace(ctx, input),
  'workspaces.update': (ctx, input) => updateWorkspace(ctx, input),
  'workspaces.delete': (ctx, input) => deleteWorkspace(ctx, input),
  // WS-02
  'members.list': (ctx, input) => listMembers(ctx, input),
  'members.add': (ctx, input) => addMember(ctx, input),
  'members.update': (ctx, input) => updateMember(ctx, input),
  'members.remove': (ctx, input) => removeMember(ctx, input),
}
