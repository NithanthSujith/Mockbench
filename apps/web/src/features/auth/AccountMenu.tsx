import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api } from '../../lib/api/client'
import { qk } from '../../lib/query-keys'
import {
  DropdownButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../components/ui'
import type { Session } from './session'

/** Topbar account slot: the signed-in email and Sign out. */
export function AccountMenu() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // The guard has already put the session in the cache; this only reads it.
  const { data: session } = useQuery<Session>({
    queryKey: qk.session(),
    queryFn: ({ signal }) => api.auth.me(undefined, { signal }),
    enabled: false,
  })

  const signOut = async () => {
    try {
      await api.auth.logout()
    } finally {
      queryClient.clear()
      void navigate({ to: '/login', replace: true })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <DropdownButton data-slot="account-menu" aria-label="Account" disabled={!session}>
          <span className="max-w-40 truncate">{session?.user.email ?? 'Account'}</span>
        </DropdownButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{session?.user.email}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
