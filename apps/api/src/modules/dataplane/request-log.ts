// RUN-07: the request-log writer and the retention pruner.
//
// The data plane calls `record(entry)` after the response is flushed and never awaits it. `record` is
// synchronous, allocation-light and cannot throw: it sanitizes the entry and pushes it on a bounded
// in-memory queue. A timer (250 ms) or a full batch (100 entries) triggers one multi-row INSERT. A
// database failure never reaches a request: the batch goes back on the queue (oldest entries are
// dropped once it holds 10,000) and is retried.
import type { RequestLogEntry } from '@mockbench/api-contract'
import { lt, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { requestLogs } from '../../db/schema'

/** What the data plane knows about a request; the writer adds `id` and `createdAt`. */
export type RequestLogInput = Omit<RequestLogEntry, 'id' | 'createdAt'> & {
  /** Routes/cases are plain uuid columns (no FK). Null/absent for mock errors. */
  matchedRouteId?: string | null
  matchedCaseId?: string | null
}

export interface RequestLog {
  record(entry: RequestLogInput): void
}

/** The default when nothing is wired (tests): discards entries. */
export const requestLog: RequestLog = {
  record(): void {
    // no writer configured
  },
}

// ---------------------------------------------------------------------------------------------------
// Redaction and truncation (spec Contract)

const REDACTED = '[redacted]'
const REDACTED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
])
/** Query keys whose values are redacted (RUN-07 open question, assumed yes). */
const REDACTED_QUERY_KEYS = new Set(['token', 'key', 'password'])
export const MAX_HEADER_VALUE = 1000
export const MAX_PATH = 2000
export const MAX_HEADERS = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Postgres text and jsonb reject NUL; cut to `max` chars. */
function clean(value: string, max: number): string {
  const v = value.includes('\u0000') ? value.replaceAll('\u0000', '') : value
  return v.length > max ? v.slice(0, max) : v
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  let n = 0
  for (const [name, value] of Object.entries(headers)) {
    if (n >= MAX_HEADERS) break
    const key = clean(name, MAX_HEADER_VALUE)
    out[key] = REDACTED_HEADERS.has(name.toLowerCase()) ? REDACTED : clean(value, MAX_HEADER_VALUE)
    n++
  }
  return out
}

export function redactQuery(
  query: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  let n = 0
  for (const [name, value] of Object.entries(query)) {
    if (n >= MAX_HEADERS) break
    const secret = REDACTED_QUERY_KEYS.has(name.toLowerCase())
    out[clean(name, MAX_HEADER_VALUE)] = secret
      ? Array.isArray(value)
        ? value.map(() => REDACTED)
        : REDACTED
      : Array.isArray(value)
        ? value.slice(0, MAX_HEADERS).map((v) => clean(v, MAX_HEADER_VALUE))
        : clean(value, MAX_HEADER_VALUE)
    n++
  }
  return out
}

// ---------------------------------------------------------------------------------------------------
// Writer

type Row = typeof requestLogs.$inferInsert

export interface RequestLogWriterOptions {
  db: Db
  logger?: LogLike
  /** Flush this long after the first queued entry. Default 250. */
  flushIntervalMs?: number
  /** Flush immediately at this many queued entries (and the rows per INSERT). Default 100. */
  batchSize?: number
  /** Queue bound; the oldest entry is dropped beyond it. Default 10,000. */
  maxQueue?: number
  /** Delay before retrying after a failed insert. Default 1000. */
  retryDelayMs?: number
  /** Clock for `created_at`. Default `Date.now`. */
  now?: () => number
}

interface LogLike {
  warn(obj: object, msg?: string): void
  info?(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

export interface RequestLogWriter extends RequestLog {
  /** Writes everything queued (stops at the first failure). Never rejects. */
  flush(): Promise<void>
  /** Stops the timers and flushes once more. Entries recorded afterwards are ignored. */
  stop(): Promise<void>
  /** Entries waiting to be written. */
  size(): number
  /** Entries dropped since start because the queue was full. */
  dropped(): number
}

function sqlstate(err: unknown): string | undefined {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4; i++) {
    if (typeof e.code === 'string') return e.code
    e = e.cause as typeof e
  }
  return undefined
}

export function createRequestLogWriter(opts: RequestLogWriterOptions): RequestLogWriter {
  const flushIntervalMs = opts.flushIntervalMs ?? 250
  const batchSize = opts.batchSize ?? 100
  const maxQueue = opts.maxQueue ?? 10_000
  const retryDelayMs = opts.retryDelayMs ?? 1000
  const now = opts.now ?? Date.now
  const log = opts.logger

  let queue: Row[] = []
  let timer: NodeJS.Timeout | null = null
  let flushing: Promise<void> | null = null
  let stopped = false
  let droppedTotal = 0
  let droppedInEpisode = 0

  const schedule = (ms: number): void => {
    if (timer || stopped) return
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, ms)
    timer.unref()
  }

  const toRow = (e: RequestLogInput): Row => ({
    projectId: e.projectId,
    versionId: e.versionId && UUID.test(e.versionId) ? e.versionId : null,
    method: clean(e.method, 16),
    path: clean(e.path, MAX_PATH),
    matchedRouteId: e.matchedRouteId && UUID.test(e.matchedRouteId) ? e.matchedRouteId : null,
    matchedCaseId: e.matchedCaseId && UUID.test(e.matchedCaseId) ? e.matchedCaseId : null,
    routePattern: e.routePattern === null ? null : clean(e.routePattern, MAX_PATH),
    caseName: e.caseName === null ? null : clean(e.caseName, MAX_HEADER_VALUE),
    statusCode: e.statusCode,
    durationMs: Math.max(0, e.durationMs),
    mockError: e.mockError,
    requestHeaders: redactHeaders(e.requestHeaders),
    query: redactQuery(e.query),
    ip: e.ip === null ? null : clean(e.ip, 64),
    createdAt: new Date(now()),
  })

  /** Puts rows back at the front, enforcing the bound by dropping the oldest. */
  const requeue = (rows: Row[]): void => {
    queue = rows.concat(queue)
    enforceBound()
  }

  const enforceBound = (): void => {
    const over = queue.length - maxQueue
    if (over <= 0) return
    queue.splice(0, over)
    droppedTotal += over
    if (droppedInEpisode === 0) {
      log?.warn(
        { dropped: over, maxQueue },
        'request log queue is full (database unavailable?): dropping the oldest entries',
      )
    }
    droppedInEpisode += over
  }

  /** A batch failed with an FK violation (project deleted meanwhile): keep every row that still fits. */
  async function insertEach(rows: Row[]): Promise<void> {
    for (const row of rows) {
      try {
        await opts.db.insert(requestLogs).values(row)
      } catch (err) {
        if (sqlstate(err) !== '23503') throw err
        // The project or version is gone: this row can never be written.
      }
    }
  }

  /** True when the queue was written out; false after a failure (a retry is already scheduled). */
  async function drain(): Promise<boolean> {
    while (queue.length > 0) {
      const batch = queue.splice(0, batchSize)
      try {
        try {
          await opts.db.insert(requestLogs).values(batch)
        } catch (err) {
          if (sqlstate(err) !== '23503') throw err
          await insertEach(batch)
        }
      } catch (err) {
        requeue(batch)
        log?.error({ err, queued: queue.length }, 'request log write failed; will retry')
        schedule(retryDelayMs)
        return false
      }
      if (droppedInEpisode > 0) {
        log?.info?.(
          { dropped: droppedInEpisode },
          'request log writes recovered after dropping entries',
        )
        droppedInEpisode = 0
      }
    }
    return true
  }

  function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    flushing ??= drain().then((ok) => {
      flushing = null
      // Entries that arrived while the insert ran (after a failure the retry timer is already set).
      if (!ok) return
      if (queue.length >= batchSize) void flush()
      else if (queue.length > 0) schedule(flushIntervalMs)
    })
    return flushing
  }

  return {
    record(entry: RequestLogInput): void {
      if (stopped) return
      try {
        queue.push(toRow(entry))
        if (queue.length > maxQueue) enforceBound()
        if (queue.length >= batchSize) {
          if (!flushing) void flush()
        } else {
          schedule(flushIntervalMs)
        }
      } catch (err) {
        log?.warn({ err }, 'request log record failed')
      }
    },
    flush,
    async stop(): Promise<void> {
      if (timer) clearTimeout(timer)
      timer = null
      await flushing
      stopped = true
      await flush()
      if (queue.length > 0) {
        log?.error({ lost: queue.length }, 'request log entries could not be written at shutdown')
      }
    },
    size: () => queue.length,
    dropped: () => droppedTotal,
  }
}

// ---------------------------------------------------------------------------------------------------
// Pruner

export const PRUNE_INTERVAL_MS = 10 * 60 * 1000

export interface RequestLogPrunerOptions {
  db: Db
  logger?: LogLike
  retentionDays: number
  retentionRows: number
  /** Default 10 minutes. */
  intervalMs?: number
  now?: () => number
}

export interface RequestLogPruner {
  /** One pass; resolves to the rows deleted, or `null` when a pass was already running (skipped). */
  run(): Promise<number | null>
  /** The start-up pass. */
  ready: Promise<number | null>
  stop(): void
}

/** Starts the pruner: once now, then every `intervalMs`. An overlapping run is skipped. */
export function startRequestLogPruner(opts: RequestLogPrunerOptions): RequestLogPruner {
  const now = opts.now ?? Date.now
  let running = false

  const run = async (): Promise<number | null> => {
    if (running) return null
    running = true
    try {
      const cutoff = new Date(now() - opts.retentionDays * 86_400_000)
      const old = await opts.db
        .delete(requestLogs)
        .where(lt(requestLogs.createdAt, cutoff))
        .returning({ id: requestLogs.id })
      // Beyond the newest N per project (only projects that exceed N are ranked).
      const over = await opts.db.execute(sql`
        DELETE FROM request_logs
        WHERE id IN (
          SELECT id FROM (
            SELECT id, row_number() OVER (
              PARTITION BY project_id ORDER BY created_at DESC, id DESC) AS rn
            FROM request_logs
            WHERE project_id IN (
              SELECT project_id FROM request_logs
              GROUP BY project_id HAVING count(*) > ${opts.retentionRows})
          ) ranked
          WHERE rn > ${opts.retentionRows})`)
      const removed = old.length + (over.rowCount ?? 0)
      if (removed > 0) opts.logger?.info?.({ removed }, 'request log pruned')
      return removed
    } catch (err) {
      opts.logger?.error({ err }, 'request log prune failed')
      return 0
    } finally {
      running = false
    }
  }

  const ready = run()
  const timer = setInterval(() => void run(), opts.intervalMs ?? PRUNE_INTERVAL_MS)
  timer.unref()
  return { run, ready, stop: () => clearInterval(timer) }
}
