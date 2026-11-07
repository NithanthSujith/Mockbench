// Vitest global setup (FND-09): migrate ONE template database per run so every withTestDb() is a
// cheap template copy. If Postgres is unreachable we stay silent here and let each test that needs a
// database fail with the actionable message from withTestDb(); tests that need no database still run.
import { randomBytes } from 'node:crypto'
import { createDb } from './client'
import { runMigrations } from './migrate'
import { TEMPLATE_ENV, connectAdmin, testAdminUrl } from './testing'

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  const adminUrl = testAdminUrl()
  let admin
  try {
    admin = await connectAdmin(adminUrl, 3000)
  } catch {
    return undefined
  }

  const name = `mb_tpl_${randomBytes(6).toString('hex')}`
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  try {
    await admin.query(`CREATE DATABASE ${name}`)
    const { db, close } = createDb(url.toString(), { max: 1 })
    try {
      await runMigrations(db)
    } finally {
      await close()
    }
  } catch (e) {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {})
    await admin.end().catch(() => {})
    console.warn(`test template database unavailable, falling back to per-test migrations: ${e}`)
    return undefined
  }
  await admin.end()

  process.env[TEMPLATE_ENV] = name
  return async () => {
    delete process.env[TEMPLATE_ENV]
    const a = await connectAdmin(adminUrl, 3000)
    try {
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    } finally {
      await a.end().catch(() => {})
    }
  }
}
