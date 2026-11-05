// Compares the Drizzle schema (db/schema.ts) with the migrated database via pg_catalog.
// Returns a list of human-readable differences; an empty list means no drift.
import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import type { Pool } from 'pg'
import { allTables } from '../schema'

type Facts = {
  columns: string[]
  indexes: string[]
  checks: string[]
  fks: string[]
}

const FK_ACTION: Record<string, string> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
}

function expectedFacts(): Record<string, Facts> {
  const out: Record<string, Facts> = {}
  for (const table of Object.values(allTables)) {
    const cfg = getTableConfig(table)
    const columns = cfg.columns.map((c) => {
      const generated = c.generated ? ' generated' : ''
      const dflt = c.hasDefault ? ' default' : ''
      return `${c.name}:${c.getSQLType()}${c.notNull ? ' not null' : ''}${dflt}${generated}`
    })
    const indexes = [
      ...cfg.indexes.map((i) => {
        const name = i.config.name
        return `${name}:${i.config.unique ? 'unique' : 'plain'}${i.config.where ? ':partial' : ''}`
      }),
      ...cfg.uniqueConstraints.map((u) => `${u.getName()}:unique`),
    ]
    const checks = cfg.checks.map((c) => c.name)
    const fks = cfg.foreignKeys.map((fk) => {
      const ref = fk.reference()
      const cols = ref.columns.map((c) => c.name).join(',')
      const fcols = ref.foreignColumns.map((c) => c.name).join(',')
      return `${fk.getName()}:${cols}->${getTableName(ref.foreignTable)}.${fcols}:${fk.onDelete ?? 'no action'}`
    })
    out[cfg.name] = {
      columns: columns.sort(),
      indexes: indexes.sort(),
      checks: checks.sort(),
      fks: fks.sort(),
    }
  }
  return out
}

async function actualFacts(pool: Pool): Promise<Record<string, Facts>> {
  const out: Record<string, Facts> = {}
  const tables = await pool.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
  )
  for (const { relname } of tables.rows) {
    const cols = await pool.query<{
      attname: string
      type: string
      attnotnull: boolean
      atthasdef: boolean
      attgenerated: string
    }>(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, a.atthasdef, a.attgenerated
       FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
      [`public.${relname}`],
    )
    const idx = await pool.query<{ name: string; unique: boolean; partial: boolean }>(
      `SELECT ic.relname AS name, i.indisunique AS "unique", i.indpred IS NOT NULL AS partial
       FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE i.indrelid = $1::regclass AND NOT i.indisprimary`,
      [`public.${relname}`],
    )
    const chk = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'`,
      [`public.${relname}`],
    )
    const fks = await pool.query<{
      conname: string
      cols: string
      ftable: string
      fcols: string
      confdeltype: string
    }>(
      `SELECT con.conname,
              (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols,
              (SELECT relname FROM pg_class WHERE oid = con.confrelid) AS ftable,
              (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS fcols,
              con.confdeltype
       FROM pg_constraint con WHERE con.conrelid = $1::regclass AND con.contype = 'f'`,
      [`public.${relname}`],
    )
    out[relname] = {
      columns: cols.rows
        .map(
          (c) =>
            `${c.attname}:${c.type}${c.attnotnull ? ' not null' : ''}${c.atthasdef && !c.attgenerated ? ' default' : ''}${c.attgenerated ? ' generated' : ''}`,
        )
        .sort(),
      indexes: idx.rows
        .map((i) => `${i.name}:${i.unique ? 'unique' : 'plain'}${i.partial ? ':partial' : ''}`)
        .sort(),
      checks: chk.rows.map((c) => c.conname).sort(),
      fks: fks.rows
        .map(
          (f) =>
            `${f.conname}:${f.cols}->${f.ftable}.${f.fcols}:${FK_ACTION[f.confdeltype] ?? f.confdeltype}`,
        )
        .sort(),
    }
  }
  return out
}

function diffList(table: string, kind: string, expected: string[], actual: string[]): string[] {
  const e = new Set(expected)
  const a = new Set(actual)
  return [
    ...expected.filter((x) => !a.has(x)).map((x) => `${table}: ${kind} missing in database: ${x}`),
    ...actual.filter((x) => !e.has(x)).map((x) => `${table}: ${kind} not in Drizzle schema: ${x}`),
  ]
}

export async function schemaDrift(pool: Pool): Promise<string[]> {
  const expected = expectedFacts()
  const actual = await actualFacts(pool)
  const diffs: string[] = []
  for (const name of Object.keys(expected)) {
    if (!actual[name]) diffs.push(`table ${name} missing in database`)
  }
  for (const name of Object.keys(actual)) {
    if (!expected[name]) diffs.push(`table ${name} not in Drizzle schema`)
  }
  for (const [name, exp] of Object.entries(expected)) {
    const act = actual[name]
    if (!act) continue
    diffs.push(
      ...diffList(name, 'column', exp.columns, act.columns),
      ...diffList(name, 'index', exp.indexes, act.indexes),
      ...diffList(name, 'check', exp.checks, act.checks),
      ...diffList(name, 'foreign key', exp.fks, act.fks),
    )
  }
  return diffs
}
