import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ConfigError, SESSION_SECRET_PLACEHOLDER, loadConfig } from '../config'

const base = { DATABASE_URL: 'postgres://u:p@db:5432/x', SESSION_SECRET: 'a-real-secret' }

describe('config.ts (the only reader of the environment)', () => {
  it('applies the documented defaults', () => {
    const c = loadConfig(base)
    expect(c).toMatchObject({
      nodeEnv: 'production',
      host: '0.0.0.0', // never loopback-only
      port: 3000,
      sessionTtlDays: 30,
      cookieSecure: false,
      allowSignup: true,
      seedDemo: true,
      logLevel: 'info',
      trustProxy: 1,
      controlRateLimit: 600,
      loginRateLimit: 10,
      mockRateLimit: null,
      logRetentionDays: 7,
      logRetentionRows: 1000,
      mockCacheMaxMb: 256,
      cacheFanout: true,
      sessionSecretIsPlaceholder: false,
    })
  })

  it('reads overrides, including booleans, ints, trust proxy forms and the data-plane cap', () => {
    const c = loadConfig({
      ...base,
      HOST: '127.0.0.1',
      API_PORT: '4000',
      COOKIE_SECURE: 'true',
      ALLOW_SIGNUP: 'false',
      SEED_DEMO: '0',
      TRUST_PROXY: '2',
      CONTROL_RATE_LIMIT: '3',
      MOCK_RATE_LIMIT: '600',
      CACHE_FANOUT: 'false',
      LOG_LEVEL: 'debug',
    })
    expect(c).toMatchObject({
      host: '127.0.0.1',
      port: 4000,
      cookieSecure: true,
      allowSignup: false,
      seedDemo: false,
      trustProxy: 2,
      controlRateLimit: 3,
      mockRateLimit: 600,
      cacheFanout: false,
      logLevel: 'debug',
    })
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true)
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).trustProxy).toBe(false)
  })

  it('an empty or missing SESSION_SECRET fails and the error names the variable', () => {
    for (const env of [
      { DATABASE_URL: base.DATABASE_URL },
      { ...base, SESSION_SECRET: '' },
      { ...base, SESSION_SECRET: '   ' },
    ]) {
      expect(() => loadConfig(env)).toThrowError(ConfigError)
      expect(() => loadConfig(env)).toThrowError(/SESSION_SECRET/)
    }
  })

  it('a missing DATABASE_URL fails naming it; all problems are reported together', () => {
    try {
      loadConfig({ SESSION_SECRET: '', API_PORT: 'abc', LOG_LEVEL: 'loud' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      const names = (e as ConfigError).problems.map((p) => p.variable).sort()
      expect(names).toEqual(['API_PORT', 'DATABASE_URL', 'LOG_LEVEL', 'SESSION_SECRET'])
    }
  })

  it('rejects malformed values naming the variable', () => {
    expect(() => loadConfig({ ...base, COOKIE_SECURE: 'maybe' })).toThrowError(/COOKIE_SECURE/)
    expect(() => loadConfig({ ...base, MOCK_RATE_LIMIT: '0' })).toThrowError(/MOCK_RATE_LIMIT/)
    expect(() => loadConfig({ ...base, MOCK_RATE_LIMIT: 'lots' })).toThrowError(/MOCK_RATE_LIMIT/)
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'sometimes' })).toThrowError(/TRUST_PROXY/)
    expect(() => loadConfig({ ...base, NODE_ENV: 'staging' })).toThrowError(/NODE_ENV/)
  })

  it('flags the .env.example placeholder, and the placeholder here equals the one in .env.example', () => {
    expect(
      loadConfig({ ...base, SESSION_SECRET: SESSION_SECRET_PLACEHOLDER })
        .sessionSecretIsPlaceholder,
    ).toBe(true)
    const example = readFileSync(
      fileURLToPath(new URL('../../../../.env.example', import.meta.url)),
      'utf8',
    )
    expect(example).toContain(`SESSION_SECRET=${SESSION_SECRET_PLACEHOLDER}`)
  })

  it('every variable in .env.example is accepted by loadConfig', () => {
    const example = readFileSync(
      fileURLToPath(new URL('../../../../.env.example', import.meta.url)),
      'utf8',
    )
    const env: Record<string, string> = { DATABASE_URL: base.DATABASE_URL }
    for (const line of example.split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
      if (m) env[m[1]!] = m[2]!.replace(/\s+#.*$/, '')
    }
    expect(() => loadConfig(env)).not.toThrow()
  })
})
