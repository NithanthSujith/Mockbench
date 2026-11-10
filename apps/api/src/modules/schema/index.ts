// Module "schema": owns the endpoint areas below. BLD-03 binds the two stateless helpers; the TYPE
// only admits ids of these areas, so binding another team's endpoint is a compile error.
import { handlers as schemaHandlers } from './schema'

export const areas = ['schema'] as const

export const handlers = schemaHandlers
