import { describe, expect, it } from 'vitest'
import { GENERATOR_VERSION } from '../src/index'
import guard from './generator-guard.json'
import { evaluateGuard } from './guard'
import { goldenFiles, goldensHash } from './helpers'

describe('generator change guard (committed state)', () => {
  it('the committed history matches GENERATOR_VERSION and every golden file', () => {
    expect(evaluateGuard(guard.history, GENERATOR_VERSION, goldensHash())).toEqual([])
  })

  it('there is at least one golden to guard', () => {
    expect(Object.keys(goldenFiles).length).toBeGreaterThanOrEqual(60)
  })
})

describe('goldensHash', () => {
  it('changes when any golden changes, and when a golden is added or removed', () => {
    const base = goldensHash(goldenFiles)
    expect(goldensHash(goldenFiles)).toBe(base)
    const [first] = Object.keys(goldenFiles)
    if (!first) throw new Error('no goldens')
    expect(goldensHash({ ...goldenFiles, [first]: `${goldenFiles[first]} ` })).not.toBe(base)
    expect(goldensHash({ ...goldenFiles, '../fixtures/new.golden.txt': 'x' })).not.toBe(base)
    const without = Object.fromEntries(Object.entries(goldenFiles).filter(([p]) => p !== first))
    expect(goldensHash(without)).not.toBe(base)
  })
})

describe('evaluateGuard (both directions)', () => {
  const H1 = 'a'.repeat(40)
  const H2 = 'b'.repeat(40)
  const H3 = 'c'.repeat(40)
  const history = [{ generatorVersion: 1, goldensHash: H1 }]

  it('passes when nothing changed', () => {
    expect(evaluateGuard(history, 1, H1)).toEqual([])
  })

  it('changing a golden without bumping the version fails, and says how to fix it', () => {
    const problems = evaluateGuard(history, 1, H2)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/goldens changed but GENERATOR_VERSION is still 1/)
    expect(problems[0]).toContain(H2)
  })

  it('bumping the version without changing a golden fails', () => {
    const problems = evaluateGuard(history, 2, H1)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/no golden changed/)
  })

  it('changing both fails until the new pair is appended', () => {
    const problems = evaluateGuard(history, 2, H2)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/both changed/)
    expect(evaluateGuard([...history, { generatorVersion: 2, goldensHash: H2 }], 2, H2)).toEqual([])
  })

  it('a history entry that reuses an earlier hash with a new version is rejected', () => {
    const cheating = [...history, { generatorVersion: 2, goldensHash: H1 }]
    expect(evaluateGuard(cheating, 2, H1).join(' ')).toMatch(/must change at least one golden/)
  })

  it('a history that does not strictly increase, or is empty, is rejected', () => {
    const bad = [
      { generatorVersion: 2, goldensHash: H1 },
      { generatorVersion: 2, goldensHash: H2 },
    ]
    expect(evaluateGuard(bad, 2, H2).join(' ')).toMatch(/not strictly increasing/)
    expect(evaluateGuard([], 1, H1)).toEqual(['generator-guard.json has no history'])
  })

  it('walks a realistic sequence: 1 -> 2 -> 3', () => {
    const h = [
      { generatorVersion: 1, goldensHash: H1 },
      { generatorVersion: 2, goldensHash: H2 },
      { generatorVersion: 3, goldensHash: H3 },
    ]
    expect(evaluateGuard(h, 3, H3)).toEqual([])
    expect(evaluateGuard(h, 3, H2)).not.toEqual([])
  })
})
