// Dev entry used by `pnpm --filter @mockbench/api dev` (tsx watch): same server, pretty logs.
export {}
process.env.NODE_ENV ??= 'development'
await import('./server')
