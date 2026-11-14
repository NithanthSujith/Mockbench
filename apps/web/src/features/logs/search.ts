import { z } from 'zod'

/** Request-log filters as they appear in the URL. Invalid values fall back to "no filter". */
export const STATUS_CLASSES = ['2xx', '4xx', '5xx'] as const
export const LOG_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const asString = (v: unknown) => (typeof v === 'number' ? String(v) : v)

export const logsSearchSchema = z.object({
  status: z.enum(STATUS_CLASSES).optional().catch(undefined),
  method: z.enum(LOG_METHODS).optional().catch(undefined),
  path: z.preprocess(asString, z.string().trim().min(1).max(200)).optional().catch(undefined),
  mockError: z
    .union([z.literal(true), z.literal('true').transform(() => true as const)])
    .optional()
    .catch(undefined),
  since: z.iso.datetime({ offset: true }).optional().catch(undefined),
})

export type LogsSearch = z.infer<typeof logsSearchSchema>

export const parseLogsSearch = (search: Record<string, unknown>): LogsSearch =>
  logsSearchSchema.parse(search)
