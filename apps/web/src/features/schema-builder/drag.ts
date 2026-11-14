import { canMoveNode, type BuilderState, type NodeId } from './store'

/** Where on a row the pointer is: above it, on it (into an object), or below it. */
export type DropZone = 'before' | 'inside' | 'after'

export interface MovePlan {
  parentId: NodeId
  /** The node's final index among the parent's children, as `moveNode` takes it. */
  index: number
  /** False when the store would refuse the move (the indicator turns `bad`). */
  ok: boolean
}

/** Rows below this many are all rendered; above it only the visible window is. */
export const VIRTUALIZE_ABOVE = 200

/** Which zone of a row a pointer at `y` falls in. Objects have a middle band meaning "drop inside". */
export function zoneAt(top: number, height: number, y: number, isObject: boolean): DropZone {
  const frac = height > 0 ? (y - top) / height : 0.5
  if (isObject) {
    if (frac < 0.25) return 'before'
    if (frac > 0.75) return 'after'
    return 'inside'
  }
  return frac < 0.5 ? 'before' : 'after'
}

/** Turn "drop `activeId` on `overId` in `zone`" into a store move, or null when nothing is hovered. */
export function planDrop(
  state: BuilderState,
  activeId: NodeId,
  overId: NodeId,
  zone: DropZone,
): MovePlan | null {
  const over = state.nodes[overId]
  if (!over || activeId === overId) return null
  let target = zone
  // Below an open object means its first child, which is where the line is drawn.
  if (zone === 'after' && over.type === 'object' && state.expanded.has(overId)) {
    if (over.childIds.length > 0) {
      return { parentId: overId, index: 0, ok: canMoveNode(state, activeId, overId) }
    }
    target = 'inside'
  }
  if (target === 'inside') {
    return {
      parentId: overId,
      index: over.childIds.length,
      ok: over.type === 'object' && canMoveNode(state, activeId, overId),
    }
  }
  const parentId = over.parentId
  const parent = parentId === null ? undefined : state.nodes[parentId]
  if (!parent || parentId === null) return null
  let index = parent.childIds.indexOf(overId) + (target === 'after' ? 1 : 0)
  const from = parent.childIds.indexOf(activeId)
  if (from !== -1 && from < index) index -= 1
  return { parentId, index, ok: canMoveNode(state, activeId, parentId) }
}

export type KeyMove = 'up' | 'down' | 'indent' | 'outdent'

export interface KeyPlan extends MovePlan {
  message: string
}

const nameOf = (state: BuilderState, id: NodeId): string => state.nodes[id]?.key ?? 'item'

/** The move an Alt+Arrow key asks for, or null when it does nothing (an edge, or not allowed). */
export function planKeyMove(state: BuilderState, id: NodeId, move: KeyMove): KeyPlan | null {
  const node = state.nodes[id]
  if (!node || node.key === null || node.parentId === null) return null
  const parent = state.nodes[node.parentId]
  if (!parent) return null
  const at = parent.childIds.indexOf(id)
  const me = nameOf(state, id)
  let plan: KeyPlan | null = null
  if (move === 'up' && at > 0) {
    const sibling = parent.childIds[at - 1] as NodeId
    plan = {
      parentId: parent.id,
      index: at - 1,
      ok: true,
      message: `moved ${me} before ${nameOf(state, sibling)}`,
    }
  } else if (move === 'down' && at < parent.childIds.length - 1) {
    const sibling = parent.childIds[at + 1] as NodeId
    plan = {
      parentId: parent.id,
      index: at + 1,
      ok: true,
      message: `moved ${me} after ${nameOf(state, sibling)}`,
    }
  } else if (move === 'indent' && at > 0) {
    const previous = state.nodes[parent.childIds[at - 1] as NodeId]
    if (previous?.type === 'object') {
      plan = {
        parentId: previous.id,
        index: previous.childIds.length,
        ok: true,
        message: `moved ${me} into ${nameOf(state, previous.id)}`,
      }
    }
  } else if (move === 'outdent' && parent.parentId !== null) {
    const grand = state.nodes[parent.parentId]
    if (grand) {
      plan = {
        parentId: grand.id,
        index: grand.childIds.indexOf(parent.id) + 1,
        ok: true,
        message: `moved ${me} after ${nameOf(state, parent.id)}`,
      }
    }
  }
  return plan && canMoveNode(state, id, plan.parentId) ? plan : null
}
