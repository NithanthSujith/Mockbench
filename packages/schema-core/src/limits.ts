/** Hard limits that keep one schema from producing a payload large enough to OOM the server. */
export const LIMITS = {
  maxDepth: 10,
  maxNodes: 2000,
  maxArrayCount: 1000,
  maxLeaves: 50000,
  maxKeyLength: 200,
  maxEnumValues: 200,
} as const
