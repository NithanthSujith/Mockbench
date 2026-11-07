import { describe, expect, it } from 'vitest'

// Every source file under src, as text (eager, so the test needs no Node APIs).
const sources = import.meta.glob(['./**/*.{ts,tsx,css}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

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

  it('has no loopback hosts, raw fetch calls or external URLs in components', () => {
    // Built from parts so this file does not trip the very lint rule it mirrors.
    const loopback = ['local', 'host'].join('') + '|' + ['127', '0', '0', '1'].join('\\.')
    const pattern = new RegExp(loopback + '|\\bfetch\\(|https?:\\/\\/(?!192\\.168\\.1\\.24)')
    const offenders = outsideStyles.filter(([, text]) => pattern.test(text))
    expect(offenders.map(([p]) => p)).toEqual([])
  })
})
