// Module "auth": owns the endpoint areas below. Fill in `handlers` in your unit; the TYPE only
// admits ids of these areas, so binding another team's endpoint is a compile error.
import type { ModuleHandlers } from '../../http/types'

export const areas = ['auth'] as const

export const handlers: ModuleHandlers<'auth'> = {}
