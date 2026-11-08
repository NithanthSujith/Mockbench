// Process entry: reads the environment (the ONLY place that touches process.env), starts the app,
// and shuts down gracefully on SIGTERM/SIGINT. It runs NO migrations: the container entrypoint runs
// `migrate` first (FND-14), so a slow migration never races a half-started server.
import { realpathSync } from 'node:fs'
import type { Server } from 'node:http'
import { pathToFileURL } from 'node:url'
import { createApp } from './app'
import type { AppDeps } from './app'
import type { DestinationStream } from 'pino'
import { ConfigError, loadConfig } from './config'
import type { Config } from './config'
import { createDb } from './db/client'
import { createLogger } from './http/logger'
import type { Logger } from './http/logger'

export interface ShutdownOptions {
  server: Server
  /** Closes the database pool. */
  closeDb: () => Promise<void>
  logger: Pick<Logger, 'info' | 'warn'>
  /** How long in-flight requests may take before connections are cut. Default 8000. */
  drainMs?: number
}

/**
 * Stops accepting connections, lets in-flight requests finish (idle keep-alive connections are
 * closed right away), force-closes whatever is left after `drainMs`, then closes the pool.
 * Resolves once everything is closed.
 */
export function createShutdown(opts: ShutdownOptions): () => Promise<void> {
  let running: Promise<void> | undefined
  return () => {
    running ??= (async () => {
      const { server } = opts
      opts.logger.info('shutting down: no longer accepting connections')
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeIdleConnections()
      const sweep = setInterval(() => server.closeIdleConnections(), 100)
      const force = setTimeout(() => {
        opts.logger.warn('drain timeout reached: closing remaining connections')
        server.closeAllConnections()
      }, opts.drainMs ?? 8000)
      try {
        await closed
      } finally {
        clearInterval(sweep)
        clearTimeout(force)
      }
      await opts.closeDb()
    })()
    return running
  }
}

export interface Started {
  config: Config
  logger: Logger
  server: Server
  shutdown: () => Promise<void>
}

export async function start(
  env: Record<string, string | undefined>,
  overrides: Partial<Pick<AppDeps, 'modules'>> & { logDestination?: DestinationStream } = {},
): Promise<Started> {
  const { logDestination, ...appOverrides } = overrides
  const config = loadConfig(env)
  const logger = createLogger(config, logDestination)
  if (config.sessionSecretIsPlaceholder) {
    logger.warn(
      'SESSION_SECRET is the placeholder from .env.example: set your own value before sharing this instance',
    )
  }

  const handle = createDb(config.databaseUrl, {
    onError: (err) => logger.error({ err }, 'database pool error'),
  })
  const app = createApp({ config, db: handle.db, pool: handle.pool, logger, ...appOverrides })

  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(config.port, config.host, () => resolve(s))
    s.once('error', reject)
  })
  logger.info({ host: config.host, port: config.port }, 'api listening')

  const shutdown = createShutdown({ server, closeDb: () => handle.close(), logger })
  return { config, logger, server, shutdown }
}

function isEntry(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return pathToFileURL(realpathSync(argv1)).href === import.meta.url
  } catch {
    return false
  }
}

if (isEntry()) {
  start(process.env)
    .then(({ shutdown, logger }) => {
      const stop = (signal: string) => {
        logger.info({ signal }, 'signal received')
        shutdown().then(
          () => process.exit(0),
          (err: unknown) => {
            logger.error({ err }, 'shutdown failed')
            process.exit(1)
          },
        )
      }
      process.once('SIGTERM', () => stop('SIGTERM'))
      process.once('SIGINT', () => stop('SIGINT'))
    })
    .catch((err: unknown) => {
      if (err instanceof ConfigError) console.error(err.message)
      else console.error(err)
      process.exit(1)
    })
}
