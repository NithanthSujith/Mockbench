import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { Button, Field, Input, Spinner } from '../../../components/ui'
import { api } from '../../../lib/api/client'
import { isApiError } from '../../../lib/api/errors'
import { resetUnauthenticated } from '../../../lib/api/unauthenticated'
import { safeRedirectTarget } from '../../../lib/auth-guard'
import { qk } from '../../../lib/query-keys'
import { AuthFrame } from '../AuthFrame'
import { getLandingPath, type Session } from '../session'

/** Where to go after a sign-in or registration: a same-origin `redirect`, else the landing path. */
export function postAuthTarget(redirect: unknown, session: Session): string {
  return safeRedirectTarget(redirect) ?? getLandingPath(session)
}

export function useInstance() {
  return useQuery({
    queryKey: qk.instance(),
    queryFn: ({ signal }) => api.system.instance(undefined, { signal }),
  })
}

export function LoginScreen() {
  const search = useSearch({ strict: false }) as { redirect?: string; reason?: 'expired' }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const instance = useInstance()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    mutationFn: () => api.auth.login({ body: { email: email.trim(), password } }),
    onSuccess: (session) => {
      resetUnauthenticated()
      queryClient.setQueryData(qk.session(), session)
      void navigate({ href: postAuthTarget(search.redirect, session), replace: true })
    },
    onError: () => setPassword(''),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!login.isPending) login.mutate()
  }

  const info = instance.data
  const canRegister = Boolean(info && (info.setupRequired || info.allowSignup))
  const error = login.error
  const errorMessage = error
    ? isApiError(error)
      ? error.message
      : 'Something went wrong. Try again.'
    : undefined

  return (
    <AuthFrame
      screen="auth/LoginScreen"
      subtitle="Sign in to the mock server running on this network."
    >
      {search.reason === 'expired' ? (
        <p role="status" className="mb-3 mt-0 text-control text-ink-2">
          Your session ended
        </p>
      ) : null}
      {instance.isPending ? (
        <Spinner />
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          {info?.setupRequired ? (
            <p className="m-0 text-control text-ink-2">
              No accounts exist yet.{' '}
              <Link to="/register" search={{ redirect: search.redirect }} className="text-signal">
                Create the first account
              </Link>
            </p>
          ) : null}
          <Field label="Email">
            <Input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" error={errorMessage}>
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={login.isPending} className="mt-1 w-full justify-center">
            {login.isPending ? 'Signing in' : 'Sign in'}
          </Button>
          {canRegister && !info?.setupRequired ? (
            <p className="m-0 text-small text-ink-3">
              Need an account?{' '}
              <Link to="/register" search={{ redirect: search.redirect }} className="text-signal">
                Register
              </Link>
            </p>
          ) : null}
          {info?.allowSignup ? (
            <p className="m-0 text-small leading-normal text-ink-3">
              This instance is open for registration. Set{' '}
              <span className="mono">ALLOW_SIGNUP=false</span> once your team has accounts.
            </p>
          ) : null}
        </form>
      )}
    </AuthFrame>
  )
}
