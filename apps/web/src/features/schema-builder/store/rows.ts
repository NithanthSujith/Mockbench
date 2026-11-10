import { isContainerType } from './convert'
import type { BuilderNode, BuilderState, NodeId, VisibleRow } from './types'

/**
 * The flat list the tree UI renders: one row per visible node, in document order. The ROOT is not a row
 * (it has no key and no parent; the UI shows its type separately and lists its children as depth 0).
 * Descendants of a collapsed container are hidden; an array's single item is a row of kind `item` one
 * level deeper than the array's own row. `duplicateKey` marks every field whose key a sibling shares.
 */
export function visibleRows(state: BuilderState): VisibleRow[] {
  const rows: VisibleRow[] = []
  const walk = (parent: BuilderNode, depth: number): void => {
    const counts = new Map<string | null, number>()
    if (parent.type === 'object') {
      for (const cid of parent.childIds) {
        const key = state.nodes[cid]?.key ?? null
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    for (const cid of parent.childIds as NodeId[]) {
      const child = state.nodes[cid]
      if (!child) continue
      const isContainer = isContainerType(child.type)
      const expanded = isContainer && state.expanded.has(cid)
      rows.push({
        id: cid,
        depth,
        kind: parent.type === 'array' ? 'item' : 'field',
        key: child.key,
        type: child.type,
        parentId: parent.id,
        isContainer,
        expanded,
        duplicateKey: parent.type === 'object' && (counts.get(child.key) ?? 0) > 1,
      })
      if (expanded) walk(child, depth + 1)
    }
  }
  const root = state.nodes[state.rootId]
  if (root && isContainerType(root.type)) walk(root, 0)
  return rows
}
