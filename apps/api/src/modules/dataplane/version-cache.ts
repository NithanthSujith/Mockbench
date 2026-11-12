// RUN-06: the data plane's version cache. slug -> project -> compiled live version, answered from
// memory once warm. Byte-bounded LRU, single-flight loads, short negative cache for unknown slugs,
// invalidated by the deploy / project-deleted hooks and by cache.flush. The database is touched only
// on a miss (2 queries at most: project, version).
import type { Snapshot } from '@mockbench/api-contract'
import { eq } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { Db } from '../../db/client'
import { projects, versions } from '../../db/schema'
import type { Hooks } from '../../http/hooks'
import { CompileError, compileVersion } from './compiled-version'
import type { CompiledVersion } from './compiled-version'

export type VersionLookup =
  | { status: 'unknown' }
  | { status: 'unpublished'; projectId: string }
  | { status: 'live'; projectId: string; version: CompiledVersion }

/** A load failed (database down, or a snapshot that cannot be compiled). Never cached; RUN-05 maps it to a 503. */
export class VersionLoadError extends Error {
  override name = 'VersionLoadError'
}

export interface VersionCacheOptions {
  db: Db
  /** Byte bound (MOCK_CACHE_MAX_MB * 1 MiB). */
  maxBytes: number
  /** How long an unknown slug is remembered. Default 5000 ms. */
  negativeTtlMs?: number
  now?: () => number
  log?: Logger
}

interface Entry {
  projectId: string
  slug: string
  /** null: the project has no active version. */
  version: CompiledVersion | null
  bytes: number
}

// Rough cost of an entry with no compiled version (the Map slots and strings).
const UNPUBLISHED_BYTES = 256

export class VersionCache {
  private readonly db: Db
  private readonly maxBytes: number
  private readonly negativeTtlMs: number
  private readonly now: () => number
  private readonly log: Logger | undefined
  /** projectId -> entry, in LRU order (oldest first). */
  private readonly entries = new Map<string, Entry>()
  private readonly slugIndex = new Map<string, string>()
  private readonly negative = new Map<string, number>()
  private readonly inflight = new Map<string, Promise<VersionLookup>>()
  private residentBytes = 0
  /** Bumped by every invalidation; a load that straddles one does not store its result. */
  private epoch = 0

  constructor(o: VersionCacheOptions) {
    this.db = o.db
    this.maxBytes = o.maxBytes
    this.negativeTtlMs = o.negativeTtlMs ?? 5000
    this.now = o.now ?? Date.now
    this.log = o.log
  }

  get bytes(): number {
    return this.residentBytes
  }

  get size(): number {
    return this.entries.size
  }

  async get(slug: string): Promise<VersionLookup> {
    const projectId = this.slugIndex.get(slug)
    if (projectId !== undefined) {
      const entry = this.entries.get(projectId)
      if (entry) {
        // Touch: move to the most-recently-used end.
        this.entries.delete(projectId)
        this.entries.set(projectId, entry)
        return toLookup(entry)
      }
    }
    const until = this.negative.get(slug)
    if (until !== undefined) {
      if (this.now() < until) return { status: 'unknown' }
      this.negative.delete(slug)
    }
    let pending = this.inflight.get(slug)
    if (!pending) {
      const started = this.epoch
      const p: Promise<VersionLookup> = this.load(slug, started).finally(() => {
        if (this.inflight.get(slug) === p) this.inflight.delete(slug)
      })
      pending = p
      this.inflight.set(slug, p)
    }
    return pending
  }

  /** Deploy / rollback: drop the project's entry. Unknown-slug entries go too, so a new slug turns live at once. */
  invalidateProject(projectId: string): void {
    this.epoch++
    this.inflight.clear()
    this.negative.clear()
    this.drop(projectId)
  }

  /** Project deleted: forget its slug and version. */
  forgetProject(projectId: string): void {
    this.epoch++
    this.inflight.clear()
    this.drop(projectId)
  }

  /** Manual flush of one project (cache.flush). */
  flushProject(projectId: string): void {
    this.invalidateProject(projectId)
  }

  private drop(projectId: string): void {
    const entry = this.entries.get(projectId)
    if (!entry) return
    this.entries.delete(projectId)
    this.residentBytes -= entry.bytes
    if (this.slugIndex.get(entry.slug) === projectId) this.slugIndex.delete(entry.slug)
  }

  private async load(slug: string, startedEpoch: number): Promise<VersionLookup> {
    try {
      const [project] = await this.db
        .select({
          id: projects.id,
          slug: projects.slug,
          activeVersionId: projects.activeVersionId,
        })
        .from(projects)
        .where(eq(projects.slug, slug))
        .limit(1)
      if (!project) {
        if (this.epoch === startedEpoch) this.negative.set(slug, this.now() + this.negativeTtlMs)
        return { status: 'unknown' }
      }
      let version: CompiledVersion | null = null
      if (project.activeVersionId) {
        const [row] = await this.db
          .select({
            label: versions.label,
            snapshot: versions.snapshot,
            baked: versions.baked,
            snapshotBytes: versions.snapshotBytes,
          })
          .from(versions)
          .where(eq(versions.id, project.activeVersionId))
          .limit(1)
        if (!row) throw new Error(`active version ${project.activeVersionId} not found`)
        version = compileVersion(row.snapshot as Snapshot, row.baked, row.label, {
          snapshotBytes: row.snapshotBytes,
          versionId: project.activeVersionId,
        })
      }
      const entry: Entry = {
        projectId: project.id,
        slug: project.slug,
        version,
        bytes: version ? Math.max(version.bytes, UNPUBLISHED_BYTES) : UNPUBLISHED_BYTES,
      }
      if (this.epoch === startedEpoch) this.store(entry)
      return toLookup(entry)
    } catch (err) {
      this.log?.error({ err, slug }, 'version cache load failed')
      throw new VersionLoadError(
        err instanceof CompileError ? err.message : 'could not load the live version',
        { cause: err },
      )
    }
  }

  private store(entry: Entry): void {
    this.drop(entry.projectId)
    this.entries.set(entry.projectId, entry)
    this.slugIndex.set(entry.slug, entry.projectId)
    this.residentBytes += entry.bytes
    // Evict least-recently-used until within the bound; the newest entry always stays.
    for (const old of [...this.entries.values()]) {
      if (this.residentBytes <= this.maxBytes || old.projectId === entry.projectId) break
      this.drop(old.projectId)
    }
  }
}

function toLookup(entry: Entry): VersionLookup {
  return entry.version
    ? { status: 'live', projectId: entry.projectId, version: entry.version }
    : { status: 'unpublished', projectId: entry.projectId }
}

// One cache per Hooks object (i.e. per app instance). app.ts creates it (registering the listeners) and
// hands it to the data plane router; the control plane only emits hooks and never imports this file.
const caches = new WeakMap<Hooks, VersionCache>()

export function registerVersionCache(
  hooks: Hooks,
  o: Omit<VersionCacheOptions, 'maxBytes'> & { maxMb: number },
): VersionCache {
  const cache = new VersionCache({ ...o, maxBytes: o.maxMb * 1024 * 1024 })
  hooks.onVersionDeployed.on((id) => cache.invalidateProject(id))
  hooks.onProjectDeleted.on((id) => cache.forgetProject(id))
  hooks.onCacheFlushRequested.on((id) => cache.flushProject(id))
  caches.set(hooks, cache)
  return cache
}

export function versionCacheOf(hooks: Hooks): VersionCache {
  const cache = caches.get(hooks)
  if (!cache) throw new Error('version cache is not initialised for this app')
  return cache
}
