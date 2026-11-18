// Dev entry used by `pnpm --filter @mockbench/api dev` (tsx watch): same server, pretty logs.
// server.ts only starts itself when it is the entry file, so this calls its `run` explicitly.
export {}
process.env.NODE_ENV ??= 'development'
const { run } = await import('./server')
run(process.env)
