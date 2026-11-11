import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { Button, Field, Input, Spinner } from '../../../components/ui'
import { api } from '../../../lib/api/client'
import { isApiError } from '../../../lib/api/errors'
import { resetUnauthenticated } from '../../../lib/api/unauthenticated'
import { qk } from '../../../lib/query-keys'
import { AuthFrame } from '../AuthFrame'
import { postAuthTarget, useInstance } from './LoginScreen'

export function RegisterScreen() {
  const search = useSearch({ strict: false }) as { redirect?: string }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const instance = useInstance()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordProblem, setPasswordProblem] = useState<string>()

  const register = useMutation({
    mutationFn: () =>
      api.auth.register({ body: { name: name.trim(), email: email.trim(), password } }),
    onSuccess: (session) => {
      resetUnauthenticated()
      queryClient.setQueryData(qk.session(), session)
      void navigate({ href: postAuthTarget(search.redirect, session), replace: true })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (register.isPending) return
    if (password.length < 8 || password.length > 128) {
      setPasswordProblem('Use 8 to 128 characters.')
      return
    }
    setPasswordProblem(undefined)
    register.mutate()
  }

  const err = register.error
  const code = isApiError(err) ? err.code : undefined
  const emailError =
    code === 'email_taken' ? 'An account with this email already exists.' : undefined
  const formError =
    err && code !== 'email_taken'
      ? code === 'signup_disabled'
        ? 'Registration is closed on this server.'
        : isApiError(err)
          ? err.message
          : 'Something went wrong. Try again.'
      : undefined

  const info = instance.data
  const closed = Boolean(info && !info.setupRequired && !info.allowSignup)

  return (
    <AuthFrame
      screen="auth/RegisterScreen"
      subtitle={
        info?.setupRequired
          ? 'Create the first account. It becomes the owner of this server.'
          : 'Create an account on the mock server running on this network.'
      }
    >
      {instance.isPending ? (
        <Spinner />
      ) : closed ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-control text-ink">Registration is closed on this server</p>
          <Link
            to="/login"
            search={{ redirect: search.redirect }}
            className="text-control text-signal"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <Field label="Name">
            <Input
              name="name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Email" error={emailError}>
            <Input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" hint="8 to 128 characters." error={passwordProblem}>
            <Input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {formError ? (
            <p role="alert" className="m-0 text-small text-bad">
              {formError}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={register.isPending}
            className="mt-1 w-full justify-center"
          >
            {register.isPending ? 'Creating account' : 'Create account'}
          </Button>
          <p className="m-0 text-small text-ink-3">
            Already have an account?{' '}
            <Link to="/login" search={{ redirect: search.redirect }} className="text-signal">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </AuthFrame>
  )
}
