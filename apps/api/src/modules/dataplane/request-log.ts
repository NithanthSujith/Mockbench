// RUN-05 seam for the request log. RUN-07 replaces `record` with the buffered writer; until then it
// is a no-op. The data plane calls it after the response is flushed and never awaits it.
import type { RequestLogEntry } from '@mockbench/api-contract'

/** What the data plane knows about a request; the writer adds `id` and `createdAt`. */
export type RequestLogInput = Omit<RequestLogEntry, 'id' | 'createdAt'>

export interface RequestLog {
  record(entry: RequestLogInput): void
}

export const requestLog: RequestLog = {
  record(): void {
    // RUN-07
  },
}
