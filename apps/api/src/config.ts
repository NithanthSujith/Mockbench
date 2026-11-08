// The ONLY place the api reads its environment. `loadConfig(env)` takes the environment as a
// parameter (server.ts passes process.env) so it is trivially testable. Variables and defaults are
// the table in docs/specs/FND-10-api-skeleton.md; .env.example mirrors it.

/** The placeholder shipped in .env.example (D8): the api starts with it but warns. */
export const SESSION_SECRET_PLACEHOLDER = 'change-me-this-is-a-placeholder-not-a-secret'

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export interface Config {
  nodeEnv: 'production' | 'development' | 'test'
  /** Bind address. Never loopback-only inside a container. */
  host: string
  port: number
  databaseUrl: string
  /** HMAC pepper for `sessions.token_hash`. */
  sessionSecret: string
  sessionSecretIsPlaceholder: boolean
  sessionTtlDays: number
  cookieSecure: boolean
  allowSignup: boolean
  seedDemo: boolean
  logLevel: LogLevel
  /** Express `trust proxy`: number of proxy hops, or a boolean. */
  trustProxy: number | boolean
  /** Control-plane requests per minute per session (client IP when unauthenticated). */
  controlRateLimit: number
  /** Login/register attempts per minute per client IP. */
  loginRateLimit: number
  /** Data-plane requests per minute per client IP; null = unlimited. */
  mockRateLimit: number | null
  logRetentionDays: number
  logRetentionRows: number
  mockCacheMaxMb: number
  cacheFanout: boolean
}

export interface ConfigProblem {
  variable: string
  message: string
}

export class ConfigError extends Error {
  readonly problems: readonly ConfigProblem[]
  constructor(problems: readonly ConfigProblem[]) {
    super(
      `Invalid configuration:\n${problems.map((p) => `  ${p.variable}: ${p.message}`).join('\n')}`,
    )
    this.name = 'ConfigError'
    this.problems = problems
  }
}

type Env = Readonly<Record<string, string | undefined>>

export function loadConfig(env: Env): Config {
  const problems: ConfigProblem[] = []
  const fail = (variable: string, message: string) => {
    problems.push({ variable, message })
  }
  const raw = (name: string): string | undefined => {
    const v = env[name]
    return v === undefined || v.trim() === '' ? undefined : v.trim()
  }
  const str = (name: string, fallback: string): string => raw(name) ?? fallback
  const int = (name: string, fallback: number, min: number): number => {
    const v = raw(name)
    if (v === undefined) return fallback
    if (!/^-?\d+$/.test(v) || Number(v) < min) {
      fail(name, `must be an integer >= ${min} (got "${v}")`)
      return fallback
    }
    return Number(v)
  }
  const bool = (name: string, fallback: boolean): boolean => {
    const v = raw(name)
    if (v === undefined) return fallback
    const l = v.toLowerCase()
    if (l === 'true' || l === '1') return true
    if (l === 'false' || l === '0') return false
    fail(name, `must be "true" or "false" (got "${v}")`)
    return fallback
  }

  const nodeEnvRaw = str('NODE_ENV', 'production')
  let nodeEnv: Config['nodeEnv'] = 'production'
  if (nodeEnvRaw === 'production' || nodeEnvRaw === 'development' || nodeEnvRaw === 'test') {
    nodeEnv = nodeEnvRaw
  } else {
    fail('NODE_ENV', `must be production, development or test (got "${nodeEnvRaw}")`)
  }

  const logLevelRaw = str('LOG_LEVEL', 'info')
  let logLevel: LogLevel = 'info'
  if ((LOG_LEVELS as readonly string[]).includes(logLevelRaw)) logLevel = logLevelRaw as LogLevel
  else fail('LOG_LEVEL', `must be one of ${LOG_LEVELS.join(', ')} (got "${logLevelRaw}")`)

  const databaseUrl = raw('DATABASE_URL')
  if (!databaseUrl) fail('DATABASE_URL', 'is required')

  const sessionSecret = raw('SESSION_SECRET')
  if (!sessionSecret) fail('SESSION_SECRET', 'is required (set it in .env; see .env.example)')

  let trustProxy: number | boolean = 1
  const tp = raw('TRUST_PROXY')
  if (tp !== undefined) {
    if (tp.toLowerCase() === 'true') trustProxy = true
    else if (tp.toLowerCase() === 'false') trustProxy = false
    else if (/^\d+$/.test(tp)) trustProxy = Number(tp)
    else fail('TRUST_PROXY', `must be a hop count, "true" or "false" (got "${tp}")`)
  }

  let mockRateLimit: number | null = null
  const mrl = raw('MOCK_RATE_LIMIT')
  if (mrl !== undefined) {
    if (/^\d+$/.test(mrl) && Number(mrl) > 0) mockRateLimit = Number(mrl)
    else fail('MOCK_RATE_LIMIT', `must be a positive integer or unset (got "${mrl}")`)
  }

  const config: Config = {
    nodeEnv,
    host: str('HOST', '0.0.0.0'),
    port: int('API_PORT', 3000, 1),
    databaseUrl: databaseUrl ?? '',
    sessionSecret: sessionSecret ?? '',
    sessionSecretIsPlaceholder: sessionSecret === SESSION_SECRET_PLACEHOLDER,
    sessionTtlDays: int('SESSION_TTL_DAYS', 30, 1),
    cookieSecure: bool('COOKIE_SECURE', false),
    allowSignup: bool('ALLOW_SIGNUP', true),
    seedDemo: bool('SEED_DEMO', true),
    logLevel,
    trustProxy,
    controlRateLimit: int('CONTROL_RATE_LIMIT', 100, 1),
    loginRateLimit: int('LOGIN_RATE_LIMIT', 10, 1),
    mockRateLimit,
    logRetentionDays: int('LOG_RETENTION_DAYS', 7, 1),
    logRetentionRows: int('LOG_RETENTION_ROWS', 1000, 1),
    mockCacheMaxMb: int('MOCK_CACHE_MAX_MB', 256, 1),
    cacheFanout: bool('CACHE_FANOUT', true),
  }
  if (problems.length > 0) throw new ConfigError(problems)
  return config
}
