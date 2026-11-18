// `bin/reset-password` — operator password reset (AUTH-04), run inside the api container:
//   docker compose exec api node dist/reset-password.js you@example.com
//   reset-password <email>                    sets a random 20-character password and prints it once
//   reset-password <email> --password-stdin   reads the password from stdin, prints no password
//   exit 0  done; exit 1  `reset-password: failed: <reason>`; exit 2  usage error or no DATABASE_URL
// Every session of the user is deleted. `main` takes env, argv and stdin as parameters.
import { randomInt } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createDb } from '../db/client'
import { resetPassword, ResetPasswordError } from '../modules/auth/reset-password'

export interface ResetPasswordResult {
  code: 0 | 1 | 2
  stdout?: string
  stderr?: string
}

const USAGE = 'usage: reset-password <email> [--password-stdin]'
// No look-alikes: 0/O/o, 1/l/I.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

export function generatePassword(length = 20): string {
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

export async function main(
  env: Record<string, string | undefined>,
  argv: readonly string[],
  stdin: () => Promise<string> = readStdin,
): Promise<ResetPasswordResult> {
  const fromStdin = argv.includes('--password-stdin')
  const rest = argv.filter((a) => a !== '--password-stdin')
  if (rest.length !== 1 || rest[0]!.startsWith('-') || !rest[0]!.trim()) {
    return { code: 2, stderr: USAGE }
  }
  const email = rest[0]!.trim()
  const url = env.DATABASE_URL
  if (!url) return { code: 2, stderr: `reset-password: DATABASE_URL is not set\n${USAGE}` }

  let password: string
  if (fromStdin) {
    // One trailing newline (from `echo` or a heredoc) is not part of the password.
    password = (await stdin()).replace(/\r?\n$/, '')
  } else {
    password = generatePassword()
  }

  const { db, close } = createDb(url, { max: 1, onError: () => {} })
  try {
    await resetPassword(db, { email, password })
    return fromStdin
      ? { code: 0, stdout: `reset-password: password set for ${email}; all sessions signed out` }
      : { code: 0, stdout: `reset-password: new password for ${email}: ${password}` }
  } catch (e) {
    return { code: 1, stderr: `reset-password: failed: ${failureReason(e)}` }
  } finally {
    await close().catch(() => {})
  }
}

/**
 * One line, and never the query: Drizzle's query errors carry the SQL parameters, which here
 * include the new password hash. Their `cause` is the driver error without them.
 */
function failureReason(e: unknown): string {
  if (e instanceof ResetPasswordError) return e.message
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e
  const msg = cause instanceof Error ? cause.message : String(cause)
  return (msg || 'unknown error').replace(/\s*\n\s*/g, ' ')
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
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
  const res = await main(process.env, process.argv.slice(2))
  if (res.stdout) console.log(res.stdout)
  if (res.stderr) console.error(res.stderr)
  process.exit(res.code)
}
