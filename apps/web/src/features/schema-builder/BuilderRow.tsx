import { useDraggable, useDroppable } from '@dnd-kit/core'
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  PackagePlus,
  Plus,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { IconButton, cn } from '../../components/ui'
import type { RowIssues } from './attr-utils'
import { AttributePanel, IssueBadges, PinControl } from './AttrControls'
import { DraftInput } from './DraftInput'
import { ExtraControl } from './ExtraControl'
import type { DropZone, KeyMove } from './drag'
import type { BuilderNode, VisibleRow } from './store'
import { TypeSelect } from './TypeSelect'

export const INDENT_BASE_PX = 15
export const INDENT_STEP_PX = 18

const KEY_MOVES: Record<string, KeyMove | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowRight: 'indent',
  ArrowLeft: 'outdent',
}

/**
 * One tree row (prototype `.brow`): twist, key, type, type-specific control, actions, in DOM order so Tab
 * walks twist -> key -> type -> extra -> actions.
 *
 * Every row has the same grid tracks, whatever its depth or kind, so the type, extra and action columns
 * line up down the whole tree. The prototype indented the whole row and ended it with an `auto` actions
 * column, so the fractional key and extra tracks shrank with depth and with the number of action
 * buttons, and the type select drifted. Here the indent lives inside the first cell (only the key field
 * gets narrower) and the actions column is fixed at the width of the most buttons a row can show.
 *
 * Below 860px the row is two lines: twist, key and type; then the extra control and the actions, which
 * are always visible. The extra control is indented by 42px past the depth indent (twist cell 16 + 2 + 16
 * plus the 8px gap) so it lines up under the key.
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
  dragEnabled = false,
  drop,
  onMoveKey,
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
  /** Show the drag handle (BLD-08). Never shown on an array's `[ item ]` row. */
  dragEnabled?: boolean
  /** The drop indicator to draw on this row while something is dragged over it. */
  drop?: { zone: DropZone; ok: boolean }
  /** An Alt+Arrow key was pressed on this row. */
  onMoveKey?: (id: string, move: KeyMove) => void
}) {
  const canDrag = dragEnabled && !readOnly && row.kind === 'field'
  const drag = useDraggable({ id: row.id, disabled: !canDrag })
  const droppable = useDroppable({ id: row.id })
  const setRowRef = (el: HTMLElement | null) => {
    drag.setNodeRef(el)
    droppable.setNodeRef(el)
  }
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
      ref={setRowRef}
      data-node-id={row.id}
      data-depth={row.depth}
      data-kind={row.kind}
      onKeyDown={(e) => {
        if (!canDrag || !onMoveKey || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
        const move = KEY_MOVES[e.key]
        if (!move) return
        e.preventDefault()
        e.stopPropagation()
        onMoveKey(row.id, move)
      }}
      className={cn(
        'group relative grid min-w-0 grid-cols-[minmax(min-content,1.6fr)_118px_minmax(0,1.1fr)_102px] items-center gap-2 py-0.75 pr-3.75 hover:bg-panel-2 max-narrow:grid-cols-[minmax(min-content,1fr)_104px] max-narrow:gap-y-1',
        drag.isDragging && 'opacity-40',
      )}
      style={
        {
          paddingLeft: INDENT_BASE_PX,
          '--indent': `${row.depth * INDENT_STEP_PX}px`,
        } as CSSProperties
      }
    >
      <div data-indent className="flex min-w-0 items-center gap-2 pl-[var(--indent)]">
        <div className="flex shrink-0 items-center gap-0.5">
          {row.kind === 'field' ? (
            <button
              type="button"
              ref={drag.setActivatorNodeRef}
              aria-label={`Drag ${label}`}
              title="Drag to reorder (Alt+Arrow keys also move the row)"
              disabled={!canDrag}
              tabIndex={-1}
              {...drag.listeners}
              className="grid size-4 shrink-0 cursor-grab touch-none place-items-center rounded-xs text-ink-3 hover:text-ink disabled:invisible"
            >
              <GripVertical aria-hidden className="size-3" />
            </button>
          ) : (
            <span aria-hidden className="size-4 shrink-0" />
          )}
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
        </div>

        {row.kind === 'item' ? (
          <span className="mono inline-block shrink-0 rounded-sm border border-dashed border-line-strong px-2 py-1.25 text-small text-ink-3">
            [ item ]
          </span>
        ) : (
          <div className="min-w-16 flex-1">
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
      </div>

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

      <div className="flex min-w-0 items-center gap-1.5 max-narrow:col-start-1 max-narrow:row-start-2 max-narrow:pl-[calc(var(--indent)+42px)]">
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
          'flex items-center justify-end gap-0.5 opacity-30 transition-ui focus-within:opacity-100 group-hover:opacity-100',
          'max-narrow:col-start-2 max-narrow:row-start-2 max-narrow:opacity-100',
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

      {drop ? (
        <span
          aria-hidden
          data-drop-indicator={drop.zone}
          data-ok={drop.ok}
          className={cn(
            'pointer-events-none absolute inset-x-0',
            drop.zone === 'before' && 'top-0 h-0.5',
            drop.zone === 'after' && 'bottom-0 h-0.5',
            drop.zone === 'inside' && 'inset-y-0 rounded-sm border-2',
            drop.zone === 'inside'
              ? drop.ok
                ? 'border-signal'
                : 'border-bad'
              : drop.ok
                ? 'bg-signal'
                : 'bg-bad',
          )}
        />
      ) : null}
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
