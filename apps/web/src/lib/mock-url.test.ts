import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMockBaseUrl, getMockHost } from './mock-url'

afterEach(() => vi.unstubAllGlobals())

function at(url: string) {
  vi.stubGlobal('location', new URL(url))
}

describe('mock URL (derived from window.location at runtime, never baked at build time)', () => {
  it('opened at a LAN IP, the base URL is that address', () => {
    at('http://192.168.1.24:8080/p/demo/routes')
    expect(getMockBaseUrl('demo')).toBe('http://192.168.1.24:8080/mock/demo')
    expect(getMockHost()).toBe('192.168.1.24:8080')
  })

  it('opened at a hostname and another port, it follows', () => {
    at('http://mockbench.office:3000/')
    expect(getMockBaseUrl('demo')).toBe('http://mockbench.office:3000/mock/demo')
    expect(getMockHost()).toBe('mockbench.office:3000')
  })

  it('keeps the scheme the page was loaded with', () => {
    at('https://mocks.example.test/')
    expect(getMockBaseUrl('billing-api')).toBe('https://mocks.example.test/mock/billing-api')
  })
})
