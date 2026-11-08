// pino, JSON to stdout (no log files). In development a pretty transport is used instead.
import { pino } from 'pino'
import type { DestinationStream, Logger } from 'pino'
import type { Config } from '../config'

export type { Logger }

export function createLogger(
  config: Pick<Config, 'logLevel' | 'nodeEnv'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.logLevel,
    base: { service: 'api' },
    timestamp: pino.stdTimeFunctions.isoTime,
  }
  if (destination) return pino(options, destination)
  if (config.nodeEnv === 'development') {
    return pino({ ...options, transport: { target: 'pino-pretty', options: { colorize: true } } })
  }
  return pino(options)
}
