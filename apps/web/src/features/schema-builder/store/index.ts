// The headless schema-builder store (BLD-06): normalised state, pure operations, undo/redo, and lossless
// conversion to and from MockSchema. No React in here; the tree UI (BLD-07) and the JSON tab (BLD-09) sit on top.
export { fromSchema, isContainerType, toSchema } from './convert'
export {
  DEFAULT_ENUM_VALUES,
  DEFAULT_FIELD_KEY,
  DEFAULT_OBJECT_FIELD_KEY,
  addField,
  canMoveNode,
  descendantsOf,
  isWithin,
  moveNode,
  previewTypeChange,
  removeNode,
  replaceAll,
  setAttr,
  setExpanded,
  setKey,
  setType,
  toggleExpanded,
} from './ops'
export type { AddFieldInit } from './ops'
export { visibleRows } from './rows'
export { COALESCE_MS, HISTORY_LIMIT, createBuilderStore } from './store'
export type { BuilderStore, BuilderStoreOptions, BuilderStoreState } from './store'
export { ATTR_APPLIES_TO, ATTR_NAMES } from './types'
export type {
  AttrName,
  BuilderNode,
  BuilderState,
  Envelope,
  NodeId,
  RowKind,
  TypeChangePreview,
  VisibleRow,
} from './types'
