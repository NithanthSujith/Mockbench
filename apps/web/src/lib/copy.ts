// Copy-to-clipboard that works on a plain-HTTP LAN address. navigator.clipboard exists only in a
// secure context (https or localhost), so on http://192.168.x.x we fall back to selecting the text
// and asking the user to press Ctrl/Cmd+C (CLAUDE.md "A LAN IP over HTTP is not a secure context").

export type CopyOutcome = 'copied' | 'selected'

export async function copyText(text: string, source?: HTMLElement | null): Promise<CopyOutcome> {
  if (window.isSecureContext && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return 'copied'
    } catch {
      // Permission denied or document not focused: fall through to the selection fallback.
    }
  }
  if (source) {
    const range = document.createRange()
    range.selectNodeContents(source)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  return 'selected'
}
