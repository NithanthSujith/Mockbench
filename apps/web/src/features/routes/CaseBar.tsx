import { CASE_STATUS_CODES, MAX_DELAY_MS, type ResponseCase } from '@mockbench/api-contract'
import { useQueryClient } from '@tanstack/react-query'
import { Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  SelectItem,
} from '../../components/ui'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'
import { qk } from '../../lib/query-keys'
import { useDebouncedSaver } from './autosave'
import { HeadersEditor } from './HeadersEditor'
import { invalidateRouteSummaries, patchCase, type CaseList, type CasePatch } from './queries'

/** '' means "inherit the project default" (null); otherwise a whole number of 0..10000 ms. */
export function parseDelay(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.trim()
  if (t === '') return { ok: true, value: null }
  if (!/^\d+$/.test(t)) return { ok: false }
  const n = Number(t)
  return n <= MAX_DELAY_MS ? { ok: true, value: n } : { ok: false }
}

const DEFAULT_DELETE_TOOLTIP = 'Make another case the default first'

/**
 * Settings of the selected case: name, status code, delay, headers, make default, delete. Each
 * change updates the cached case immediately (status, delay, headers, name) and persists; a server
 * error puts the previous value back and shows the message. Mount it with `key={case.id}`.
 */
export function CaseBar({
  caseItem,
  projectId,
  routeId,
  projectDefaultDelayMs,
  canEdit,
  track,
  onDeleted,
}: {
  caseItem: ResponseCase
  projectId: string
  routeId: string
  projectDefaultDelayMs: number
  canEdit: boolean
  track: (promise: Promise<unknown>) => Promise<unknown>
  onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(caseItem.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [delay, setDelay] = useState(caseItem.delayMs === null ? '' : String(caseItem.delayMs))
  const [headerNonce, setHeaderNonce] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const delayCheck = parseDelay(delay)

  function current(): ResponseCase {
    return (
      queryClient
        .getQueryData<CaseList>(qk.route(projectId, routeId).cases)
        ?.items.find((c) => c.id === caseItem.id) ?? caseItem
    )
  }

  async function save(patch: CasePatch) {
    setFailure(null)
    try {
      await track(patchCase(queryClient, projectId, routeId, caseItem.id, patch))
      setNameError(null)
    } catch (error) {
      const message = isApiError(error) ? error.message : 'Could not save the case.'
      const latest = current()
      if (isApiError(error) && error.code === 'case_name_taken') {
        setNameError(message)
        setName(latest.name)
      } else {
        setFailure(message)
        if ('name' in patch) setName(latest.name)
      }
      if ('delayMs' in patch) setDelay(latest.delayMs === null ? '' : String(latest.delayMs))
      if ('headers' in patch) setHeaderNonce((n) => n + 1)
      throw error
    }
  }

  const saver = useDebouncedSaver<CasePatch>(save, { enabled: canEdit })

  async function makeDefault() {
    setBusy(true)
    setFailure(null)
    try {
      await api.cases.setDefault({ params: { caseId: caseItem.id } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.route(projectId, routeId).cases }),
        invalidateRouteSummaries(queryClient, projectId, routeId),
      ])
    } catch (error) {
      setFailure(isApiError(error) ? error.message : 'Could not change the default case.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setFailure(null)
    try {
      await api.cases.delete({ params: { caseId: caseItem.id } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.route(projectId, routeId).cases }),
        invalidateRouteSummaries(queryClient, projectId, routeId),
      ])
      setConfirming(false)
      onDeleted()
    } catch (error) {
      setConfirming(false)
      setFailure(isApiError(error) ? error.message : 'Could not delete the case.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-screen="routes/CaseBar" className="flex flex-col gap-3 p-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <Field label="Case name" className="min-w-40 flex-1" error={nameError}>
          <Input
            value={name}
            disabled={!canEdit}
            maxLength={60}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
              if (e.target.value.trim() === '') saver.drop('name')
              else saver.schedule({ name: e.target.value })
            }}
          />
        </Field>
        <Field label="Status" className="w-28">
          <Select
            mono
            value={String(caseItem.statusCode)}
            disabled={!canEdit}
            onValueChange={(v) => {
              void save({ statusCode: Number(v) }).catch(() => undefined)
            }}
          >
            {CASE_STATUS_CODES.map((code) => (
              <SelectItem key={code} value={String(code)}>
                {code}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field
          label="Delay (ms)"
          className="w-44"
          error={delayCheck.ok ? null : `Enter a whole number from 0 to ${MAX_DELAY_MS}.`}
          hint={
            delay.trim() === ''
              ? `Inherits the project default (${projectDefaultDelayMs} ms)`
              : null
          }
        >
          <Input
            mono
            inputMode="numeric"
            value={delay}
            disabled={!canEdit}
            autoComplete="off"
            onChange={(e) => {
              setDelay(e.target.value)
              const check = parseDelay(e.target.value)
              if (check.ok) saver.schedule({ delayMs: check.value })
              else saver.drop('delayMs')
            }}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-1.25">
        <span className="text-small text-ink-2">Headers</span>
        <HeadersEditor
          key={`${caseItem.id}:${headerNonce}`}
          initial={current().headers}
          disabled={!canEdit}
          onValid={(headers) => saver.schedule({ headers })}
          onInvalid={() => saver.drop('headers')}
        />
      </div>
      {failure ? (
        <p role="alert" className="m-0 text-small text-bad">
          {failure}
        </p>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={caseItem.isDefault || busy}
            onClick={() => void makeDefault()}
          >
            <Star aria-hidden className="size-3.5" />
            {caseItem.isDefault ? 'Default case' : 'Make default'}
          </Button>
          <span title={caseItem.isDefault ? DEFAULT_DELETE_TOOLTIP : undefined}>
            <Button
              variant="ghost"
              size="sm"
              disabled={caseItem.isDefault || busy}
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden className="size-3.5" />
              Delete case
            </Button>
          </span>
        </div>
      ) : null}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title="Delete case"
          description={
            <>
              Delete <span className="mono text-ink">{caseItem.name}</span>? This cannot be undone.
              Published versions are not affected.
            </>
          }
        >
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button disabled={busy} onClick={() => void remove()}>
              Delete case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
