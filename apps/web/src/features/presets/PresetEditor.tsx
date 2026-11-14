import type { Preset } from '@mockbench/api-contract'
import { NODE_TYPES, type PresetRule } from '@mockbench/schema-core'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Eyebrow,
  Field,
  IconButton,
  Input,
  Segmented,
  Select,
  SelectItem,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '../../components/ui'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'
import { qk } from '../../lib/query-keys'
import {
  ANY_TYPE,
  KINDS,
  blankDraft,
  buildSample,
  draftFromRule,
  nameProblem,
  patternPreview,
  priorityProblem,
  ruleFromDraft,
  type Kind,
  type RuleDraft,
} from './rules'

const KIND_LABEL: Record<Kind, string> = { value: 'Value', values: 'Values', pattern: 'Pattern' }
const KIND_PLACEHOLDER: Record<Kind, string> = {
  value: 'INR',
  values: 'admin, manager, viewer',
  pattern: 'ID-{n:05}',
}

export interface EditorTarget {
  /** The preset being edited; `null` creates a new one. */
  preset: Preset | null
}

function EditorForm({
  projectId,
  preset,
  readOnly,
  onDone,
}: {
  projectId: string
  preset: Preset | null
  readOnly: boolean
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(preset?.name ?? '')
  const [priority, setPriority] = useState(String(preset?.priority ?? 0))
  const [drafts, setDrafts] = useState<RuleDraft[]>(() =>
    preset ? preset.rules.map(draftFromRule) : [],
  )
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const checked = useMemo(() => drafts.map(ruleFromDraft), [drafts])
  const validRules = useMemo(() => checked.flatMap((c) => (c.rule ? [c.rule] : [])), [checked])
  const priorityNumber = priorityProblem(priority) === undefined ? Number(priority) : 0
  const sample = useMemo(
    () => buildSample(validRules, priorityNumber),
    [validRules, priorityNumber],
  )
  const sampleByRule = useMemo(() => {
    const rows = new Map<string, (typeof sample)[number]>()
    let at = 0
    drafts.forEach((d, i) => {
      if (checked[i]?.rule) rows.set(d.id, sample[at++] as (typeof sample)[number])
    })
    return rows
  }, [drafts, checked, sample])

  const nameError = nameProblem(name)
  const priorityError = priorityProblem(priority)
  const update = (id: string, patch: Partial<RuleDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (readOnly || saving) return
    setAttempted(true)
    if (nameError || priorityError || checked.some((c) => c.problems)) return
    const rules: PresetRule[] = validRules
    setSaving(true)
    setFailure(null)
    try {
      if (preset) {
        await api.presets.update({
          params: { presetId: preset.id },
          body: { name: name.trim(), priority: Number(priority), rules },
        })
      } else {
        await api.presets.create({
          params: { projectId },
          body: { name: name.trim(), priority: Number(priority), rules },
        })
      }
      await queryClient.invalidateQueries({ queryKey: qk.project(projectId).presets })
      onDone()
    } catch (error) {
      setFailure(isApiError(error) ? error.message : 'Could not save the preset.')
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Field label="Name" error={attempted ? nameError : undefined}>
          <Input
            value={name}
            disabled={readOnly}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="Priority"
          error={attempted ? priorityError : undefined}
          hint="Higher wins a tie."
        >
          <Input
            mono
            inputMode="numeric"
            value={priority}
            disabled={readOnly}
            onChange={(e) => setPriority(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <Eyebrow>Rules</Eyebrow>
        {drafts.length === 0 ? (
          <p className="m-0 text-small text-ink-2">No rules yet.</p>
        ) : (
          <Table aria-label="Rules">
            <THead>
              <tr>
                <Th>Key</Th>
                <Th>Path</Th>
                <Th>Type</Th>
                <Th>Output</Th>
                <Th>Result</Th>
                <Th>
                  <span className="sr-only">Remove</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {drafts.map((d, i) => {
                const problems = checked[i]?.problems
                const row = sampleByRule.get(d.id)
                const n = i + 1
                return (
                  <Tr key={d.id} className="align-top">
                    <Td className="min-w-32">
                      <Input
                        mono
                        aria-label={`Rule ${n} key`}
                        placeholder="currency"
                        value={d.key}
                        disabled={readOnly}
                        onChange={(e) => update(d.id, { key: e.target.value })}
                      />
                      {attempted && problems?.match ? (
                        <p role="alert" className="m-0 pt-1 text-small text-bad">
                          {problems.match}
                        </p>
                      ) : null}
                    </Td>
                    <Td className="min-w-36">
                      <Input
                        mono
                        aria-label={`Rule ${n} path`}
                        placeholder="$.address.city"
                        value={d.path}
                        disabled={readOnly}
                        onChange={(e) => update(d.id, { path: e.target.value })}
                      />
                    </Td>
                    <Td className="min-w-28">
                      <Select
                        mono
                        aria-label={`Rule ${n} type`}
                        value={d.type}
                        disabled={readOnly}
                        onValueChange={(v) => update(d.id, { type: v })}
                      >
                        <SelectItem value={ANY_TYPE}>any</SelectItem>
                        {NODE_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </Select>
                    </Td>
                    <Td className="min-w-56">
                      <div className="flex flex-col gap-1.5">
                        <Segmented
                          label={`Rule ${n} output kind`}
                          value={d.kind}
                          onValueChange={(v) => {
                            if (!readOnly) update(d.id, { kind: v as Kind })
                          }}
                          items={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                        />
                        <Input
                          mono
                          aria-label={`Rule ${n} ${d.kind}`}
                          placeholder={KIND_PLACEHOLDER[d.kind]}
                          value={d.text}
                          disabled={readOnly}
                          onChange={(e) => update(d.id, { text: e.target.value })}
                        />
                        {d.kind === 'pattern' && d.text.trim() !== '' ? (
                          <p
                            data-testid={`pattern-preview-${n}`}
                            className="mono m-0 text-small text-ink-2"
                          >
                            {patternPreview(d.text.trim(), d.key.trim()).map((p, j) => (
                              <span key={p.n}>
                                {j > 0 ? ' · ' : ''}n={p.n} {'→'} {p.text}
                              </span>
                            ))}
                          </p>
                        ) : null}
                        {attempted && problems?.output ? (
                          <p role="alert" className="m-0 text-small text-bad">
                            {problems.output}
                          </p>
                        ) : null}
                      </div>
                    </Td>
                    <Td className="mono min-w-40 text-small text-ink-2">{row?.text ?? '—'}</Td>
                    <Td>
                      {readOnly ? null : (
                        <IconButton
                          aria-label={`Remove rule ${n}`}
                          onClick={() => setDrafts((prev) => prev.filter((x) => x.id !== d.id))}
                        >
                          <Trash2 aria-hidden className="size-3.5" />
                        </IconButton>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        )}
        {readOnly ? null : (
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDrafts((p) => [...p, blankDraft()])}
            >
              <Plus aria-hidden className="size-3.5" />
              Add rule
            </Button>
          </div>
        )}
      </div>

      <section aria-label="Live sample" className="flex flex-col gap-1.5">
        <Eyebrow>Live sample</Eyebrow>
        <p className="m-0 text-small text-ink-3">
          Each rule applied to a four-element sample array, the way a publish would bake it.
        </p>
        {sample.length === 0 ? (
          <p className="m-0 text-small text-ink-2">Add a valid rule to see its output.</p>
        ) : (
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {sample.map((row, i) => (
              <div key={`${row.label}-${i}`} className="contents">
                <dt className="mono text-small text-ink-3">{row.label}</dt>
                <dd data-testid="sample-row" className="mono m-0 text-small text-ink">
                  {row.text}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {failure ? (
        <p role="alert" className="m-0 text-small text-bad">
          {failure}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">{readOnly ? 'Close' : 'Cancel'}</Button>
        </DialogClose>
        {readOnly ? null : (
          <Button type="submit" disabled={saving}>
            Save preset
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}

/** Create / edit dialog for one preset. Viewers get the same view with every control disabled. */
export function PresetEditor({
  projectId,
  target,
  readOnly,
  onClose,
}: {
  projectId: string
  target: EditorTarget | null
  readOnly: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        className="max-h-[90vh] max-w-5xl overflow-y-auto"
        title={target?.preset ? (readOnly ? 'Preset' : 'Edit preset') : 'New preset'}
        description="A preset is a named set of rules that decide the value of matching fields."
      >
        {target ? (
          <EditorForm
            key={target.preset?.id ?? 'new'}
            projectId={projectId}
            preset={target.preset}
            readOnly={readOnly}
            onDone={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
