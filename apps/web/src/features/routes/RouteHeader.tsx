import { parseRoutePath, type Route } from '@mockbench/api-contract'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Copy } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Field, Input, Select, SelectItem, Textarea } from '../../components/ui'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'
import { qk } from '../../lib/query-keys'
import { useDebouncedSaver, type SaveState } from './autosave'
import { METHODS } from './NewRouteDialog'

type Method = (typeof METHODS)[number]
type RoutePatch = { method: Method; path: string; description: string | null }

export function SaveIndicator({ state }: { state: SaveState }) {
  const text =
    state === 'saving'
      ? 'Saving…'
      : state === 'saved'
        ? 'Saved'
        : state === 'error'
          ? 'Not saved'
          : ''
  return (
    <span
      role="status"
      aria-live="polite"
      className={state === 'error' ? 'text-small text-bad' : 'text-small text-ink-3'}
    >
      {text}
    </span>
  )
}

/**
 * Method, path and description of the route, autosaved 600 ms after the last change. A path that
 * `parseRoutePath` rejects is flagged live and never sent; a colliding path shows the server's
 * message inline and the fields go back to the saved values.
 */
export function RouteHeader({
  route,
  projectId,
  projectSlug,
  canEdit,
  track,
  saveState,
}: {
  route: Route
  projectId: string
  projectSlug: string
  canEdit: boolean
  track: (promise: Promise<unknown>) => Promise<unknown>
  saveState: SaveState
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [method, setMethod] = useState<Method>(route.method)
  const [path, setPath] = useState(route.path)
  const [description, setDescription] = useState(route.description ?? '')
  const [conflict, setConflict] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState(false)

  const parsed = parseRoutePath(path)
  const pathIssue = !parsed.ok ? (parsed.issues[0]?.message ?? 'Invalid path.') : null

  const saver = useDebouncedSaver<RoutePatch>(
    async (patch) => {
      setFailure(null)
      try {
        const saved = await track(api.routes.update({ params: { routeId: route.id }, body: patch }))
        queryClient.setQueryData(qk.route(projectId, route.id).detail, saved)
        await queryClient.invalidateQueries({ queryKey: qk.project(projectId).routes })
        setConflict(null)
      } catch (error) {
        const latest =
          queryClient.getQueryData<Route>(qk.route(projectId, route.id).detail) ?? route
        if (isApiError(error) && error.code === 'route_conflict') {
          setConflict(error.message)
          setMethod(latest.method)
          setPath(latest.path)
        } else {
          setFailure(isApiError(error) ? error.message : 'Could not save the route.')
        }
        throw error
      }
    },
    { enabled: canEdit },
  )

  async function duplicate() {
    setDuplicating(true)
    setFailure(null)
    try {
      const copy = await api.routes.duplicate({ params: { routeId: route.id }, body: {} })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.project(projectId).routes }),
        queryClient.invalidateQueries({ queryKey: qk.projectBySlug(projectSlug) }),
      ])
      await navigate({
        to: '/p/$projectSlug/routes/$routeId',
        params: { projectSlug, routeId: copy.id },
      })
    } catch (error) {
      setFailure(isApiError(error) ? error.message : 'Could not duplicate the route.')
    } finally {
      setDuplicating(false)
    }
  }

  return (
    <Card data-screen="routes/RouteHeader" className="flex flex-col gap-3 p-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Method" className="w-28">
          <Select
            mono
            value={method}
            disabled={!canEdit}
            onValueChange={(v) => {
              setMethod(v as Method)
              setConflict(null)
              saver.schedule({ method: v as Method })
            }}
          >
            {METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label="Path" className="min-w-48 flex-1" error={pathIssue ?? conflict}>
          <Input
            mono
            value={path}
            disabled={!canEdit}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              const next = e.target.value
              setPath(next)
              setConflict(null)
              if (parseRoutePath(next).ok) saver.schedule({ path: next })
              else saver.drop('path')
            }}
          />
        </Field>
        <div className="flex items-center gap-3 pb-2">
          <SaveIndicator state={saveState} />
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={duplicating}
              onClick={() => void duplicate()}
            >
              <Copy aria-hidden className="size-3.5" />
              Duplicate
            </Button>
          ) : null}
        </div>
      </div>
      <Field label="Description">
        <Textarea
          value={description}
          disabled={!canEdit}
          rows={2}
          onChange={(e) => {
            setDescription(e.target.value)
            saver.schedule({ description: e.target.value === '' ? null : e.target.value })
          }}
        />
      </Field>
      {failure ? (
        <p role="alert" className="m-0 text-small text-bad">
          {failure}
        </p>
      ) : null}
    </Card>
  )
}
