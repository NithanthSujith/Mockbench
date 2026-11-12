import { isContainerType, type BuilderState, type NodeId } from './store'

// Collapsed nodes per editor (case) for the life of the page, so collapsing a node survives a switch
// to another case and back. Not in the URL and not persisted. Node ids are deterministic for a given
// schema (`n<counter>`), so the same schema maps to the same ids on the way back.
const collapsedBySession = new Map<string, ReadonlySet<NodeId>>()

export function rememberCollapsed(sessionKey: string, state: BuilderState): void {
  const collapsed = new Set<NodeId>()
  for (const id of Object.keys(state.nodes)) {
    const node = state.nodes[id]
    if (node && isContainerType(node.type) && !state.expanded.has(id)) collapsed.add(id)
  }
  collapsedBySession.set(sessionKey, collapsed)
}

export function recallCollapsed(sessionKey: string): ReadonlySet<NodeId> {
  return collapsedBySession.get(sessionKey) ?? new Set()
}
