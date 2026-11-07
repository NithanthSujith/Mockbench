/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const baseCss = read('./index.css')
const themeCss = read('./theme.css')

/** Reads `--color-<name>: #rrggbb;` declarations out of the theme file. */
function tokens(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of themeCss.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]!] = m[2]!.toLowerCase()
  }
  return out
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('theme tokens (extracted from the prototype)', () => {
  const t = tokens()

  it('defines every token named in the FND-12 contract with the contract value', () => {
    const expected: Record<string, string> = {
      bg: '#0c0f13',
      panel: '#14181e',
      'panel-2': '#1a1f27',
      'panel-3': '#222935',
      slab: '#0e1217',
      ink: '#e8ecf2',
      'ink-2': '#99a3b1',
      'ink-3': '#7c8794',
      line: '#242b35',
      'line-strong': '#39424e',
      'slab-line': '#20262f',
      btn: '#e8ecf2',
      'btn-ink': '#14171c',
      signal: '#e0b152',
      'signal-soft': '#312513',
      'signal-line': '#6b5422',
      good: '#4ade80',
      warn: '#e0b152',
      bad: '#fb7185',
      info: '#7ca0ff',
      'm-get': '#7ca0ff',
      'm-post': '#5dd08a',
      'm-put': '#b79bff',
      'm-patch': '#56c7d8',
      'm-delete': '#fb7185',
      't-key': '#9bb4ff',
      't-str': '#8ed8a8',
      't-num': '#e8b37a',
      't-bool': '#c9a2ff',
      't-null': '#7b8696',
      't-punc': '#5f6b7c',
    }
    expect(t).toEqual(expected)
  })

  it('ink on bg is at least 7:1', () => {
    expect(contrast(t.ink!, t.bg!)).toBeGreaterThanOrEqual(7)
  })
  it('ink-2 on panel is at least 4.5:1', () => {
    expect(contrast(t['ink-2']!, t.panel!)).toBeGreaterThanOrEqual(4.5)
  })
  it('ink-3 on panel is at least 4.5:1 (raised from the prototype)', () => {
    expect(contrast(t['ink-3']!, t.panel!)).toBeGreaterThanOrEqual(4.5)
  })
  it('ink-3 on bg and on panel-2 also pass AA for small text', () => {
    expect(contrast(t['ink-3']!, t.bg!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['ink-3']!, t['panel-2']!)).toBeGreaterThanOrEqual(4.5)
  })
  for (const name of ['good', 'warn', 'bad', 'info'] as const) {
    it(`${name} on panel is at least 4.5:1`, () => {
      expect(contrast(t[name]!, t.panel!)).toBeGreaterThanOrEqual(4.5)
    })
  }
  it('the primary button text is readable on its background', () => {
    expect(contrast(t['btn-ink']!, t.btn!)).toBeGreaterThanOrEqual(7)
  })
})

describe('dark mode only', () => {
  it('sets color-scheme: dark on :root and defines no light theme', () => {
    expect(baseCss).toMatch(/:root\s*{[^}]*color-scheme:\s*dark/)
    expect(baseCss + themeCss).not.toMatch(/color-scheme:\s*light/)
    expect(baseCss + themeCss).not.toMatch(/prefers-color-scheme/)
  })
  it('declares focus-visible with the signal ring', () => {
    expect(baseCss).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px solid var\(--color-signal\)/)
  })
  it('honours prefers-reduced-motion', () => {
    expect(baseCss).toMatch(/prefers-reduced-motion:\s*reduce/)
  })
  it('loads fonts only from local @fontsource packages', () => {
    expect(baseCss).toMatch(/@fontsource\/archivo\/latin-400\.css/)
    expect(baseCss).toMatch(/@fontsource\/ibm-plex-mono\/latin-400\.css/)
    expect(baseCss + themeCss).not.toMatch(/https?:\/\//)
  })
})
