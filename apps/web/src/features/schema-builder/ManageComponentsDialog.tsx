import type { MockNode } from '@mockbench/schema-core'
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogClose,
  IconButton,
  Input,
} from '../../components/ui'
import { isApiError } from '../../lib/api/errors'
import { COMPONENT_NAME, MAX_COMPONENTS, cyclicComponents, renameRefs } from './attr-utils'

export type ComponentMap = Record<string, MockNode>

/** An object subtree the user chose to save ("Save as component"). */
export interface ComponentSource {
  node: MockNode
  suggestedName: string
}

function problemWith(name: string, taken: ComponentMap, ignore?: string): string | null {
  if (!COMPONENT_NAME.test(name)) {
    return 'Use letters, digits and underscores, starting with a letter (up to 64 characters).'
  }
  if (name !== ignore && Object.prototype.hasOwnProperty.call(taken, name)) {
    return `A component named "${name}" already exists.`
  }
  return null
}

function messageOf(error: unknown): string {
  if (isApiError(error) || error instanceof Error) return error.message
  return 'Could not save the components.'
}

function ComponentRow({
  name,
  cyclic,
  readOnly,
  busy,
  components,
  onRename,
  onDelete,
}: {
  name: string
  cyclic: boolean
  readOnly: boolean
  busy: boolean
  components: ComponentMap
  onRename: (to: string) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(name)
  const problem = draft === name ? null : problemWith(draft, components, name)
  return (
    <li className="flex flex-wrap items-center gap-2" data-component={name}>
      <Input
        mono
        aria-label={`Name of component ${name}`}
        aria-invalid={problem !== null || undefined}
        className="w-48 py-1.25 text-small"
        value={draft}
        disabled={readOnly || busy}
        onChange={(e) => setDraft(e.target.value)}
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Rename ${name}`}
        disabled={readOnly || busy || draft === name || problem !== null}
        onClick={() => onRename(draft)}
      >
        Rename
      </Button>
      <IconButton
        aria-label={`Delete component ${name}`}
        title="Delete"
        className="size-7 hover:text-bad"
        disabled={readOnly || busy}
        onClick={onDelete}
      >
        <Trash2 aria-hidden className="size-3.5" />
      </IconButton>
      {cyclic ? (
        <span
          role="status"
          data-issue="ref_cycle"
          className="rounded-full bg-bad/14 px-2 py-0.5 text-tiny font-semibold text-bad"
        >
          ref_cycle: refers to itself
        </span>
      ) : null}
      {problem ? (
        <span role="alert" className="basis-full text-tiny text-bad">
          {problem}
        </span>
      ) : null}
    </li>
  )
}

/**
 * The project's components: list, add (empty, or from a saved object subtree), rename, delete. Every
 * change is one `projects.update { components }` through `onSave`; the server's refusal (a component a
 * stored case still uses) is shown verbatim and nothing changes.
 */
export function ManageComponentsDialog({
  open,
  onOpenChange,
  components,
  readOnly,
  onSave,
  onRenamed,
  source,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  components: ComponentMap
  readOnly: boolean
  onSave: (next: ComponentMap) => Promise<void>
  /** Point the open case's refs at the new name; returns how many it changed. */
  onRenamed: (from: string, to: string) => number
  source: ComponentSource | null
}) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setNewName(source?.suggestedName ?? '')
    setError(null)
    setNotice(null)
  }, [open, source])

  const names = Object.keys(components)
  const cyclic = cyclicComponents(components)
  const addProblem =
    newName === ''
      ? null
      : (problemWith(newName, components) ??
        (names.length >= MAX_COMPONENTS
          ? `A project may have at most ${MAX_COMPONENTS} components.`
          : null))

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    run(async () => {
      const node: MockNode = source?.node ?? { type: 'object', fields: [] }
      await onSave({ ...components, [newName]: node })
      setNotice(`Added "${newName}".`)
      setNewName('')
    })

  const remove = (name: string) =>
    run(async () => {
      const next = { ...components }
      delete next[name]
      await onSave(next)
    })

  const rename = (from: string, to: string) =>
    run(async () => {
      const moved: ComponentMap = {}
      for (const [n, node] of Object.entries(components)) {
        moved[n === from ? to : n] = renameRefs(node, from, to)
      }
      let kept = false
      try {
        await onSave(moved)
      } catch (e) {
        // A stored case still refers to the old name, so it cannot go yet: keep both names.
        if (!(isApiError(e) && e.status === 422)) throw e
        const both: ComponentMap = {}
        for (const [n, node] of Object.entries(components)) {
          both[n] = renameRefs(node, from, to)
          if (n === from) both[to] = renameRefs(node, from, to)
        }
        await onSave(both)
        kept = true
      }
      const changed = onRenamed(from, to)
      setNotice(
        `Renamed to "${to}": updated ${changed} reference${changed === 1 ? '' : 's'} in this case. ` +
          `Other cases that use "${from}" must be updated by hand` +
          (kept ? `, so "${from}" was kept until nothing uses it.` : '.'),
      )
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Manage components"
        description="Components are named schema nodes a ref can point at. Changes apply to the next publish."
        className="max-w-xl"
      >
        {names.length === 0 ? (
          <p className="m-0 text-control text-ink-3">No components yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {names.map((name) => (
              <ComponentRow
                key={name}
                name={name}
                cyclic={cyclic.has(name)}
                readOnly={readOnly}
                busy={busy}
                components={components}
                onRename={(to) => void rename(name, to)}
                onDelete={() => void remove(name)}
              />
            ))}
          </ul>
        )}

        {readOnly ? null : (
          <form
            className="mt-4 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (newName !== '' && addProblem === null) void add()
            }}
          >
            <Input
              mono
              aria-label="New component name"
              aria-invalid={addProblem !== null || undefined}
              placeholder="ComponentName"
              className="w-48 py-1.25 text-small"
              value={newName}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              disabled={busy || newName === '' || addProblem !== null}
            >
              {source ? 'Save as component' : 'Add component'}
            </Button>
            {source ? (
              <span className="text-small text-ink-3">from the selected object</span>
            ) : null}
            {addProblem ? (
              <span role="alert" className="basis-full text-tiny text-bad">
                {addProblem}
              </span>
            ) : null}
          </form>
        )}

        {error ? (
          <p role="alert" className="mb-0 mt-3 text-small text-bad">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mb-0 mt-3 text-small text-ink-2">
            {notice}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
