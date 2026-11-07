import { describe, expect, it, vi } from 'vitest'
import { formatUuid, sha1, uuidv5 } from './index'

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

describe('sha1 (known answers, synchronous, no crypto)', () => {
  it('sha1("abc") is a9993e364706816aba3e25717850c26c9cd0d89d', () => {
    expect(hex(sha1(utf8('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })
  it('sha1("") is da39a3ee5e6b4b0d3255bfef95601890afd80709', () => {
    expect(hex(sha1(utf8('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })
  it('handles a two-block message (FIPS 180 vector)', () => {
    const msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'
    expect(hex(sha1(utf8(msg)))).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1')
  })
  it('handles lengths around the padding boundary (55, 56, 63, 64 bytes)', () => {
    const known: Record<number, string> = {
      55: 'c1c8bbdc22796e28c0e15163d20899b65621d65a',
      56: 'c2db330f6083854c99d4b5bfb6e8f29f201be699',
      63: '03f09f5b158a7a8cdad920bddc29b81c18a551f5',
      64: '0098ba824b5c16427bd7a1122a5a442a25ec644d',
    }
    for (const [len, digest] of Object.entries(known))
      expect(hex(sha1(utf8('a'.repeat(Number(len)))))).toBe(digest)
  })
})

describe('uuidv5', () => {
  const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
  it('matches the RFC 4122 / Python reference for DNS + python.org', () => {
    expect(uuidv5(DNS, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
  })
  it('is deterministic, version 5, RFC variant', () => {
    const a = uuidv5(DNS, 'x')
    expect(a).toBe(uuidv5(DNS, 'x'))
    expect(a).not.toBe(uuidv5(DNS, 'y'))
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  it('encodes non-ASCII names as UTF-8', () => {
    expect(uuidv5(DNS, 'café')).toMatch(/^[0-9a-f-]{36}$/)
    expect(uuidv5(DNS, 'café')).not.toBe(uuidv5(DNS, 'cafe'))
  })
  it('rejects a malformed namespace', () => {
    expect(() => uuidv5('not-a-uuid', 'x')).toThrow()
  })
  it('formatUuid formats 16 bytes', () => {
    expect(formatUuid(new Uint8Array(16))).toBe('00000000-0000-0000-0000-000000000000')
  })
  it('works with crypto removed (insecure-context simulation)', () => {
    vi.stubGlobal('crypto', undefined)
    try {
      expect(uuidv5(DNS, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
