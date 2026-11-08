import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './copy'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('copyText (clipboard needs a secure context; a LAN IP over HTTP is not one)', () => {
  it('uses the async clipboard in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyText('hello')).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('on an insecure origin it selects the source text instead, and never throws', async () => {
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('navigator', {})
    document.body.innerHTML = '<span id="src">http://192.168.1.24:8080/mock/demo</span>'
    const src = document.getElementById('src')
    expect(await copyText('x', src)).toBe('selected')
    expect(window.getSelection()?.toString()).toBe('http://192.168.1.24:8080/mock/demo')
  })

  it('falls back to selecting when the clipboard rejects (permission denied)', async () => {
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    document.body.innerHTML = '<span id="src">abc</span>'
    expect(await copyText('abc', document.getElementById('src'))).toBe('selected')
  })
})
