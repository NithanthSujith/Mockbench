import { describe, expect, it } from 'vitest'

// Every source file under src, as text (eager, so the test needs no Node APIs).
const sources = import.meta.glob(['./**/*.{ts,tsx,css}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Drops full-line comments: prose there may legitimately mention hosts. Code is still scanned. */
function withoutCommentLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n')
}

const outsideStyles = Object.entries(sources).filter(([path]) => !path.startsWith('./styles/'))

describe('source hygiene', () => {
  it('found the component sources', () => {
    expect(outsideStyles.length).toBeGreaterThan(10)
  })

  it('has no colour literals outside src/styles', () => {
    const offenders = outsideStyles.filter(([, text]) =>
      /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(text),
    )
    expect(offenders.map(([p]) => p)).toEqual([])
  })

  it('has no dark: variants anywhere (dark mode only)', () => {
    const offenders = Object.entries(sources).filter(([, text]) => /\bdark:/.test(text))
    expect(offenders.map(([p]) => p)).toEqual([])
  })

  it('has no loopback hosts or external URLs in code (comments excluded)', () => {
    // Built from parts so this file does not trip the very lint rule it mirrors.
    const loopback = ['local', 'host'].join('') + '|' + ['127', '0', '0', '1'].join('\\.')
    const pattern = new RegExp(loopback + '|https?:\\/\\/(?!192\\.168\\.1\\.24)')
    const offenders = outsideStyles.filter(([, text]) => pattern.test(withoutCommentLines(text)))
    expect(offenders.map(([p]) => p)).toEqual([])
  })

  it('calls fetch only inside src/lib/api (lint rule 4)', () => {
    const offenders = outsideStyles.filter(
      ([path, text]) =>
        !path.startsWith('./lib/api/') && /\bfetch\(/.test(withoutCommentLines(text)),
    )
    expect(offenders.map(([p]) => p)).toEqual([])
  })
})
