// Operator password reset (AUTH-04). The only recovery path when the only owner forgets their
// password: there is no email reset (ADR 0020). Called by `bin/reset-password`, never over HTTP.
import { PasswordField } from '@mockbench/api-contract'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { sessions, users } from '../../db/schema'
import { hashPassword } from './passwords'

export class ResetPasswordError extends Error {}

/**
 * Sets the user's Argon2id hash and deletes every session they have, in one transaction.
 * The email match is case-insensitive (citext). `is_active` is left alone.
 */
export async function resetPassword(
  db: Db,
  input: { email: string; password: string },
): Promise<{ userId: string; sessionsRevoked: number }> {
  if (!PasswordField.safeParse(input.password).success) {
    throw new ResetPasswordError('password must be 8-128 characters')
  }
  // Hash outside the transaction so no row lock is held during the deliberately slow hash.
  const passwordHash = await hashPassword(input.password)
  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.email, input.email))
      .returning({ id: users.id })
    if (!user) throw new ResetPasswordError('no user with that email')
    const revoked = await tx
      .delete(sessions)
      .where(eq(sessions.userId, user.id))
      .returning({ id: sessions.id })
    return { userId: user.id, sessionsRevoked: revoked.length }
  })
}
