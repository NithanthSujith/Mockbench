// Child-process entry for the kill test: runs the real runMigrations() against <url> using the
// migrations in <folder> (a deliberately slow one), until the parent kills this process.
import { createDb } from '../../client'
import { runMigrations } from '../../migrate'

const [url, folder] = process.argv.slice(2)
if (!url || !folder) {
  console.error('usage: run-migrations.ts <url> <migrations-folder>')
  process.exit(2)
}

const { db } = createDb(url, { max: 1, onError: () => {} })
const { applied } = await runMigrations(db, { migrationsFolder: folder })
console.log(`applied ${applied}`)
process.exit(0)
