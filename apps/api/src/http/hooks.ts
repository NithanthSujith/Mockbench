// In-process hook registry: the ONLY sanctioned way for modules to signal each other without
// importing each other (e.g. Projects tells Runtime's cache that a project was deleted).
// A listener that throws never stops the others and never propagates to the emitter.
import type { Logger } from 'pino'

export type HookListener = (projectId: string) => void | Promise<void>

export class HookPoint {
  readonly name: string
  private readonly listeners: HookListener[] = []
  private readonly log: Logger | undefined

  constructor(name: string, log?: Logger) {
    this.name = name
    this.log = log
  }

  /** Registers a listener; returns a function that removes it. */
  on(listener: HookListener): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  get size(): number {
    return this.listeners.length
  }

  /** Calls every listener once, in registration order. Never rejects. */
  async emit(projectId: string): Promise<void> {
    for (const listener of [...this.listeners]) {
      try {
        await listener(projectId)
      } catch (err) {
        this.log?.error({ err, hook: this.name, projectId }, 'hook listener failed')
      }
    }
  }
}

export interface Hooks {
  /** A version was deployed (or rolled back) for the project; the cache must drop its entry. */
  onVersionDeployed: HookPoint
  /** The project was deleted; the cache must forget its slug and version. */
  onProjectDeleted: HookPoint
}

export function createHooks(log?: Logger): Hooks {
  return {
    onVersionDeployed: new HookPoint('onVersionDeployed', log),
    onProjectDeleted: new HookPoint('onProjectDeleted', log),
  }
}
