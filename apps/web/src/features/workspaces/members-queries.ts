import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Member } from '@mockbench/api-contract'
import { api } from '../../lib/api/client'
import { qk } from '../../lib/query-keys'
import type { LoaderArgs } from '../../lib/route-loader'
import { getSession } from '../auth/session'

export type Role = Member['role']
export const ROLES: readonly Role[] = ['owner', 'editor', 'viewer']

interface MembersPage {
  items: Member[]
  nextCursor: string | null
}

export function membersOptions(workspaceId: string) {
  return {
    queryKey: qk.members(workspaceId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.members.list({ params: { workspaceId } }, { signal }) as Promise<MembersPage>,
  }
}

export function useMembers(workspaceId: string | undefined) {
  return useQuery({ ...membersOptions(workspaceId ?? ''), enabled: workspaceId !== undefined })
}

/** Warm the member list for the workspace in the URL. Never blocks or fails the navigation. */
export async function prefetchMembers({ queryClient, params }: LoaderArgs) {
  try {
    const session = await getSession(queryClient)
    const workspace = session?.workspaces.find((w) => w.slug === params.wsSlug)
    if (workspace) await queryClient.prefetchQuery(membersOptions(workspace.id))
  } catch {
    // The screen shows its own error state.
  }
}

/** Adds a user by email. Not optimistic (the server supplies name and id); appends on success. */
export function useAddMember(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; role: Role }) =>
      api.members.add({ params: { workspaceId }, body }),
    onSuccess: (member) => {
      queryClient.setQueryData<MembersPage>(qk.members(workspaceId), (old) =>
        old && !old.items.some((m) => m.id === member.id)
          ? { ...old, items: [...old.items, member] }
          : old,
      )
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) })
      await queryClient.invalidateQueries({ queryKey: qk.session() })
    },
  })
}

/** Optimistic role change; rolls the cache back on any error. */
export function useUpdateMemberRole(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { memberId: string; role: Role }) =>
      api.members.update({ params: { workspaceId, memberId: v.memberId }, body: { role: v.role } }),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: qk.members(workspaceId) })
      const previous = queryClient.getQueryData<MembersPage>(qk.members(workspaceId))
      queryClient.setQueryData<MembersPage>(qk.members(workspaceId), (old) =>
        old
          ? {
              ...old,
              items: old.items.map((m) => (m.id === v.memberId ? { ...m, role: v.role } : m)),
            }
          : old,
      )
      return { previous }
    },
    onError: (_error, _v, context) => {
      if (context?.previous) queryClient.setQueryData(qk.members(workspaceId), context.previous)
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) })
      await queryClient.invalidateQueries({ queryKey: qk.session() })
    },
  })
}

/** Optimistic removal; rolls back on any error. `self` skips refetching a list we no longer may read. */
export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { memberId: string; self: boolean }) =>
      api.members.remove({ params: { workspaceId, memberId: v.memberId } }),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: qk.members(workspaceId) })
      const previous = queryClient.getQueryData<MembersPage>(qk.members(workspaceId))
      queryClient.setQueryData<MembersPage>(qk.members(workspaceId), (old) =>
        old ? { ...old, items: old.items.filter((m) => m.id !== v.memberId) } : old,
      )
      return { previous }
    },
    onError: (_error, _v, context) => {
      if (context?.previous) queryClient.setQueryData(qk.members(workspaceId), context.previous)
    },
    onSettled: async (_data, error, v) => {
      if (v.self && !error) queryClient.removeQueries({ queryKey: qk.members(workspaceId) })
      else await queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) })
      await queryClient.invalidateQueries({ queryKey: qk.session() })
    },
  })
}
