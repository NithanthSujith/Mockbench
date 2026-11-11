import { RESERVED_SLUGS as CONTRACT_RESERVED, Slug } from '@mockbench/api-contract'
import { describe, expect, it } from 'vitest'
import { deriveSlug, RESERVED_SLUGS, SLUG_FORMAT_RULE, slugProblem } from './slug'

describe('project slug rules', () => {
  it('reserved list matches the contract', () => {
    expect([...RESERVED_SLUGS].sort()).toEqual([...CONTRACT_RESERVED].sort())
  })

  it('derives a slug from a name', () => {
    expect(deriveSlug('Billing API v2')).toBe('billing-api-v2')
    expect(deriveSlug('  --Ünï  code!! ')).toBe('n-code')
    expect(deriveSlug('x'.repeat(60))).toHaveLength(40)
    expect(deriveSlug('a'.repeat(39) + ' b')).toBe('a'.repeat(39))
  })

  it('agrees with the contract format rule', () => {
    for (const slug of ['billing', 'a-b', 'ab', 'Billing', 'a--b', '-ab', 'ab-', 'x'.repeat(41)]) {
      const contractOk = Slug.safeParse(slug).success
      expect(slugProblem(slug) === null).toBe(contractOk)
    }
    expect(slugProblem('')).toBeNull()
    expect(slugProblem('api')).toBe('api is reserved')
    expect(slugProblem('Billing')).toBe(SLUG_FORMAT_RULE)
  })
})
