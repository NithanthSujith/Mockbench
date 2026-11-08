// The role matrix of API-CONTRACT 1.3, encoded ONCE. Every module authorises through this file and
// the loaders next to it; no handler compares roles by hand.
//
//   viewer  - every GET
//   editor  - viewer + create projects; change a project/routes/cases/presets/components; publish,
//             deploy/rollback, delete versions, flush cache, import a project
//   owner   - editor + delete a project, rename/delete the workspace, manage members
//
// Roles are per workspace; there is no instance-wide admin. The registry marks each endpoint with the
// MINIMUM level it needs (`auth`), so the matrix is exactly "auth level -> minimum workspace role".
import type { AuthLevel } from '@mockbench/api-contract'

export const ROLES = ['viewer', 'editor', 'owner'] as const
export type Role = (typeof ROLES)[number]

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }

/** True when `role` is at least `min` (viewer < editor < owner). */
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min]
}

export interface AuthPolicy {
  /** The endpoint needs a signed-in user (everything except `public`). */
  readonly requiresSession: boolean
  /** Minimum role in the owning workspace, or null when no workspace membership is involved. */
  readonly minRole: Role | null
}

/** Auth level (as written on every registry endpoint) -> what it demands. */
export const AUTH_POLICY: Readonly<Record<AuthLevel, AuthPolicy>> = {
  public: { requiresSession: false, minRole: null },
  session: { requiresSession: true, minRole: null },
  viewer: { requiresSession: true, minRole: 'viewer' },
  editor: { requiresSession: true, minRole: 'editor' },
  owner: { requiresSession: true, minRole: 'owner' },
}

/** Minimum role an auth level needs, or null for `public`/`session`. Throws on an unknown level. */
export function minRoleFor(level: AuthLevel): Role | null {
  const policy = AUTH_POLICY[level]
  if (!policy) throw new Error(`auth level "${String(level)}" is missing from AUTH_POLICY`)
  return policy.minRole
}
