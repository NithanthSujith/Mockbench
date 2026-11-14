import {
  ChevronDown,
  ChevronRight,
  PackagePlus,
  Plus,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { IconButton, cn } from '../../components/ui'
import type { RowIssues } from './attr-utils'
import { AttributePanel, IssueBadges, PinControl } from './AttrControls'
import { DraftInput } from './DraftInput'
import { ExtraControl } from './ExtraControl'
import type { BuilderNode, VisibleRow } from './store'
import { TypeSelect } from './TypeSelect'

export const INDENT_BASE_PX = 15
export const INDENT_STEP_PX = 18

/**
 * One tree row (prototype `.brow`): twist, key, type, type-specific control, actions. The five cells are
 * in DOM order so Tab walks twist -> key -> type -> extra -> actions. Below 860px the extra cell drops to
 * a second line and the actions are always visible.
 */
export function BuilderRow({
  row,
  node,
  flag,
  readOnly,
  onToggle,
  onKey,
  onType,
  onValues,
  onCount,
  onAdd,
  onRemove,
  onAttr,
  componentNames,
  issues,
  onSaveAsComponent,
}: {
  row: VisibleRow
  node: BuilderNode
  /** An amber note about this node (an inferred null whose real type is unknown). */
  flag?: string
  readOnly: boolean
  onToggle: (id: string) => void
  onKey: (id: string, key: string) => void
  onType: (id: string, type: string) => void
  onValues: (id: string, values: string[]) => void
  onCount: (id: string, count: number) => void
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  /** Edit any attribute of this node (BLD-10). */
  onAttr: (id: string, name: string, value: unknown) => void
  /** The components a `ref` row can point at. */
  componentNames?: readonly string[]
  issues?: RowIssues
  /** Offered on object rows when the caller can save components. */
  onSaveAsComponent?: (id: string) => void
}) {
  const label = row.key ?? '[ item ]'
  const [panelOpen, setPanelOpen] = useState(false)
  const extraKeys = [...Object.keys(node.extras), ...Object.keys(node.entryExtras ?? {})]
  const description =
    typeof node.attrs.description === 'string' && node.attrs.description !== ''
      ? node.attrs.description
      : undefined
  const setAttr = (name: string, value: unknown) => onAttr(row.id, name, value)
  return (
    <div
      role="group"
      aria-label={label}
      title={description}
      data-node-id={row.id}
      data-depth={row.depth}
      data-kind={row.kind}
      className="group grid min-w-0 grid-cols-[auto_minmax(96px,1.3fr)_118px_minmax(0,1.4fr)_auto] items-center gap-2 py-0.75 pr-3.75 hover:bg-panel-2 max-[860px]:grid-cols-[auto_minmax(80px,1fr)_104px] max-[860px]:gap-y-1"
      style={{ paddingLeft: INDENT_BASE_PX + row.depth * INDENT_STEP_PX }}
    >
      {row.isContainer ? (
        <button
          type="button"
          aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${label}`}
          aria-expanded={row.expanded}
          onClick={() => onToggle(row.id)}
          className="grid size-4 shrink-0 place-items-center rounded-xs text-ink-3 transition-ui hover:bg-panel-3 hover:text-ink"
        >
          {row.expanded ? (
            <ChevronDown aria-hidden className="size-3" />
          ) : (
            <ChevronRight aria-hidden className="size-3" />
          )}
        </button>
      ) : (
        <span aria-hidden className="size-4 shrink-0" />
      )}

      {row.kind === 'item' ? (
        <span className="mono inline-block rounded-sm border border-dashed border-line-strong px-2 py-1.25 text-small text-ink-3">
          [ item ]
        </span>
      ) : (
        <div className="min-w-0">
          <DraftInput
            aria-label="Field name"
            data-node-input={row.id}
            aria-invalid={row.duplicateKey || undefined}
            value={row.key ?? ''}
            disabled={readOnly}
            className={cn(
              'border-transparent bg-transparent py-1.25 text-control hover:border-line focus:border-line-strong focus:bg-panel-2',
              row.duplicateKey && 'border-warn',
            )}
            onDraft={(text) => {
              onKey(row.id, text)
              return text
            }}
          />
          {row.duplicateKey ? (
            <span
              role="status"
              className="mt-0.5 inline-flex items-center gap-1 text-tiny text-warn"
            >
              <TriangleAlert aria-hidden className="size-3" />
              duplicate key
            </span>
          ) : null}
        </div>
      )}

      <div className="min-w-0">
        <TypeSelect
          value={row.type}
          label="Type"
          disabled={readOnly}
          onChange={(t) => onType(row.id, t)}
        />
        {flag && row.type === 'string' && node.attrs.nullable === true ? (
          <span
            role="status"
            data-flag="inferred-null"
            className="mt-0.5 inline-flex items-center gap-1 text-tiny text-warn"
          >
            <TriangleAlert aria-hidden className="size-3" />
            {flag}
          </span>
        ) : null}
        <IssueBadges issues={issues} refName={node.attrs.name} />
      </div>

      <div className="flex min-w-0 items-center gap-1.5 max-[860px]:col-span-full max-[860px]:row-start-2 max-[860px]:pl-6">
        <ExtraControl
          node={node}
          disabled={readOnly}
          onValues={(v) => onValues(row.id, v)}
          onCount={(c) => onCount(row.id, c)}
          componentNames={componentNames}
          onRefName={(n) => setAttr('name', n)}
        />
        <PinControl node={node} disabled={readOnly} onAttr={setAttr} />
      </div>

      <div
        className={cn(
          'flex items-center gap-0.5 opacity-30 transition-ui focus-within:opacity-100 group-hover:opacity-100',
          'max-[860px]:col-start-3 max-[860px]:row-start-1 max-[860px]:opacity-100',
        )}
      >
        <IconButton
          aria-label={`Attributes of ${label}`}
          title="Attributes"
          aria-expanded={panelOpen}
          className={cn('size-6 border-transparent bg-transparent', panelOpen && 'text-signal')}
          onClick={() => setPanelOpen((o) => !o)}
        >
          <SlidersHorizontal aria-hidden className="size-3.5" />
        </IconButton>
        {row.type === 'object' && onSaveAsComponent ? (
          <IconButton
            aria-label={`Save ${label} as component`}
            title="Save as component"
            className="size-6 border-transparent bg-transparent"
            disabled={readOnly}
            onClick={() => onSaveAsComponent(row.id)}
          >
            <PackagePlus aria-hidden className="size-3.5" />
          </IconButton>
        ) : null}
        {row.type === 'object' ? (
          <IconButton
            aria-label="Add field"
            title="Add field"
            className="size-6 border-transparent bg-transparent"
            disabled={readOnly}
            onClick={() => onAdd(row.id)}
          >
            <Plus aria-hidden className="size-3.5" />
          </IconButton>
        ) : null}
        {row.kind === 'field' ? (
          <IconButton
            aria-label="Remove field"
            title="Remove field"
            className="size-6 border-transparent bg-transparent hover:text-bad"
            disabled={readOnly}
            onClick={() => onRemove(row.id)}
          >
            <X aria-hidden className="size-3.5" />
          </IconButton>
        ) : null}
      </div>

      {extraKeys.length > 0 ? (
        <div
          data-testid="extra-attributes"
          title="Kept as they are and saved with the schema; edit them in the JSON tab"
          className="mono col-span-full pl-6 text-tiny text-ink-3"
        >
          extra attributes: {extraKeys.join(', ')}
        </div>
      ) : null}
      {panelOpen ? <AttributePanel node={node} disabled={readOnly} onAttr={setAttr} /> : null}
    </div>
  )
}
