// Argon2id password hashing (AUTH-02). @node-rs/argon2 ships prebuilt binaries for linux musl and
// arm64, so the image needs no compiler toolchain. Parameters are the OWASP minimum (19 MiB, t=2, p=1);
// they are encoded in each hash, so raising them later does not invalidate stored hashes.
import { hash, verify } from '@node-rs/argon2'

// Argon2id is the library default.
const PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

export function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMS)
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password)
  } catch {
    // A malformed stored hash can never match.
    return false
  }
}

let dummy: Promise<string> | undefined

/**
 * Verifies against a throwaway hash so an unknown email costs the same as a wrong password.
 * Always resolves false.
 */
export async function verifyDummy(password: string): Promise<false> {
  dummy ??= hashPassword('mockbench-timing-equaliser')
  await verifyPassword(await dummy, password)
  return false
}
