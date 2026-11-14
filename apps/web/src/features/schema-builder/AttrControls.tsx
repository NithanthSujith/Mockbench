import { Pin, PinOff, Plus, TriangleAlert, X } from 'lucide-react'
import { Button, IconButton, Select, SelectItem, cn } from '../../components/ui'
import {
  NO_ISSUES,
  defaultLiteral,
  isNumeric,
  isPinnable,
  literalFromText,
  literalToText,
  parseNumberText,
  type RowIssues,
} from './attr-utils'
import { DraftInput } from './DraftInput'
import type { BuilderNode } from './store'

export type SetAttr = (name: string, value: unknown) => void

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
const nameOf = (node: BuilderNode): string => node.key ?? 'root'

/** Token classes of the prototype's pinned input: signal-soft fill, signal-line border. */
const PINNED = 'border-signal-line bg-signal-soft'

function BooleanSelect({
  value,
  label,
  disabled,
  onChange,
  className,
}: {
  value: string
  label: string
  disabled: boolean
  onChange: (value: boolean) => void
  className?: string
}) {
  return (
    <Select
      mono
      value={value}
      disabled={disabled}
      aria-label={label}
      onValueChange={(v) => onChange(v === 'true')}
      className={cn('py-1.25 pl-2 text-small', className)}
    >
      <SelectItem value="true">true</SelectItem>
      <SelectItem value="false">false</SelectItem>
    </Select>
  )
}

/**
 * The pin toggle and, once pinned, the typed input for the pinned value. A pinned row stores `fixed`
 * (by key presence, so `0`, `""`, `false` and `null` are real pins); unpinning removes the key.
 */
export function PinControl({
  node,
  disabled,
  onAttr,
}: {
  node: BuilderNode
  disabled: boolean
  onAttr: SetAttr
}) {
  if (!isPinnable(node.type)) return null
  const name = nameOf(node)
  const pinned = has(node.attrs, 'fixed')
  const fixed = node.attrs.fixed
  const toggle = (
    <IconButton
      aria-label={pinned ? `Unpin ${name}` : `Pin value for ${name}`}
      aria-pressed={pinned}
      title={pinned ? 'Unpin: generate this value again' : 'Pin a fixed value'}
      className={cn('size-6 shrink-0 border-transparent bg-transparent', pinned && 'text-signal')}
      disabled={disabled}
      onClick={() => onAttr('fixed', pinned ? undefined : defaultLiteral(node))}
    >
      {pinned ? (
        <PinOff aria-hidden className="size-3.5" />
      ) : (
        <Pin aria-hidden className="size-3.5" />
      )}
    </IconButton>
  )
  if (!pinned) return toggle

  let input
  if (fixed === null) {
    input = (
      <span
        data-testid="pinned-null"
        className={cn('mono flex-1 rounded-sm border px-2 py-1.25 text-small text-signal', PINNED)}
      >
        null
      </span>
    )
  } else if (node.type === 'boolean' && typeof fixed === 'boolean') {
    input = (
      <BooleanSelect
        value={String(fixed)}
        label={`Pinned value for ${name}`}
        disabled={disabled}
        onChange={(v) => onAttr('fixed', v)}
        className={cn('flex-1', PINNED)}
      />
    )
  } else {
    input = (
      <DraftInput
        aria-label={`Pinned value for ${name}`}
        type={isNumeric(node.type) && typeof fixed === 'number' ? 'number' : undefined}
        value={literalToText(fixed)}
        disabled={disabled}
        className={cn('flex-1 py-1.25 text-small text-signal', PINNED)}
        onDraft={(text) => {
          const next = literalFromText(node.type, text)
          if (next !== undefined) onAttr('fixed', next)
          return text
        }}
      />
    )
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      {toggle}
      {input}
    </span>
  )
}

/** The expandable per-row panel: nullable, description, min/max, pin null and the examples list. */
export function AttributePanel({
  node,
  disabled,
  onAttr,
}: {
  node: BuilderNode
  disabled: boolean
  onAttr: SetAttr
}) {
  const name = nameOf(node)
  const pinnable = isPinnable(node.type)
  const examples = Array.isArray(node.attrs.examples) ? (node.attrs.examples as unknown[]) : []
  const setExample = (i: number, value: unknown) =>
    onAttr(
      'examples',
      examples.map((e, j) => (j === i ? value : e)),
    )
  const removeExample = (i: number) => {
    const next = examples.filter((_, j) => j !== i)
    onAttr('examples', next.length === 0 ? undefined : next)
  }
  const numberAttr = (attr: 'min' | 'max') => (
    <label className="flex items-center gap-1.5 text-small text-ink-3">
      {attr}
      <DraftInput
        aria-label={`${attr === 'min' ? 'Min' : 'Max'} for ${name}`}
        type="number"
        value={typeof node.attrs[attr] === 'number' ? String(node.attrs[attr]) : ''}
        disabled={disabled}
        className="w-24 bg-transparent py-1.25 text-small text-ink-2"
        onDraft={(text) => {
          if (text.trim() === '') onAttr(attr, undefined)
          else {
            const n = parseNumberText(text)
            if (n !== null) onAttr(attr, n)
          }
          return text
        }}
      />
    </label>
  )

  return (
    <div
      data-testid="attribute-panel"
      className="col-span-full flex flex-col gap-2 rounded-sm border border-line bg-panel-2 px-3 py-2 max-[860px]:ml-6"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5 text-small text-ink-2">
          <input
            type="checkbox"
            className="accent-signal"
            aria-label={`Nullable for ${name}`}
            checked={node.attrs.nullable === true}
            disabled={disabled}
            onChange={(e) => onAttr('nullable', e.target.checked ? true : undefined)}
          />
          nullable
        </label>
        {isNumeric(node.type) ? (
          <>
            {numberAttr('min')}
            {numberAttr('max')}
          </>
        ) : null}
        {pinnable ? (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={node.attrs.fixed === null && has(node.attrs, 'fixed')}
            aria-label={`Pin null for ${name}`}
            disabled={disabled}
            onClick={() => onAttr('fixed', null)}
          >
            Pin null
          </Button>
        ) : null}
      </div>
      <label className="flex items-center gap-1.5 text-small text-ink-3">
        description
        <DraftInput
          aria-label={`Description for ${name}`}
          placeholder="Shown as a tooltip on the row"
          value={typeof node.attrs.description === 'string' ? node.attrs.description : ''}
          disabled={disabled}
          className="flex-1 bg-transparent py-1.25 text-small text-ink-2"
          onDraft={(text) => {
            onAttr('description', text === '' ? undefined : text)
            return text
          }}
        />
      </label>
      {pinnable ? (
        <div className="flex flex-col gap-1.5" role="group" aria-label={`Examples for ${name}`}>
          <span className="text-small text-ink-3">
            examples{examples.length > 1 ? ' (cycled in order)' : ''}
          </span>
          {examples.map((example, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {node.type === 'boolean' && typeof example === 'boolean' ? (
                <BooleanSelect
                  value={String(example)}
                  label={`Example ${i + 1} for ${name}`}
                  disabled={disabled}
                  onChange={(v) => setExample(i, v)}
                  className="w-28"
                />
              ) : (
                <DraftInput
                  aria-label={`Example ${i + 1} for ${name}`}
                  type={isNumeric(node.type) && typeof example === 'number' ? 'number' : undefined}
                  value={literalToText(example)}
                  disabled={disabled}
                  className="w-48 bg-transparent py-1.25 text-small text-ink-2"
                  onDraft={(text) => {
                    const next = literalFromText(node.type, text)
                    if (next !== undefined) setExample(i, next)
                    return text
                  }}
                />
              )}
              <IconButton
                aria-label={`Remove example ${i + 1} for ${name}`}
                className="size-6 border-transparent bg-transparent hover:text-bad"
                disabled={disabled}
                onClick={() => removeExample(i)}
              >
                <X aria-hidden className="size-3.5" />
              </IconButton>
            </div>
          ))}
          <div>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Add example for ${name}`}
              disabled={disabled}
              onClick={() => onAttr('examples', [...examples, defaultLiteral(node)])}
            >
              <Plus aria-hidden className="size-3.5" />
              Add example
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Red badges for `min_greater_than_max`, `unknown_ref` and `ref_cycle`. */
export function IssueBadges({
  issues = NO_ISSUES,
  refName,
}: {
  issues?: RowIssues
  refName?: unknown
}) {
  const badge = (code: string, text: string) => (
    <span
      key={code}
      role="status"
      data-issue={code}
      className="inline-flex items-center gap-1 rounded-full bg-bad/14 px-2 py-0.5 text-tiny font-semibold text-bad"
    >
      <TriangleAlert aria-hidden className="size-3" />
      {text}
    </span>
  )
  const out = []
  if (issues.minGreaterThanMax) out.push(badge('min_greater_than_max', 'min is greater than max'))
  if (issues.unknownRef) {
    out.push(
      badge(
        'unknown_ref',
        typeof refName === 'string' ? `unknown_ref: no component "${refName}"` : 'unknown_ref',
      ),
    )
  }
  if (issues.refCycle) out.push(badge('ref_cycle', 'ref_cycle: component refers to itself'))
  if (out.length === 0) return null
  return <div className="mt-0.5 flex flex-wrap gap-1">{out}</div>
}
