import { Fragment, useMemo, type HTMLAttributes } from 'react'
import { cn } from './cn'
import { Slab } from './misc'

/** Mirrors schema-core's generate() provenance values (kept local: apps/web does not import it yet). */
export type Provenance = 'fixed' | 'preset' | 'example' | 'enum' | 'generated' | 'random'

type TokenKind = 'key' | 'str' | 'num' | 'bool' | 'null' | 'punc' | 'ws'
type Token = { text: string; kind: TokenKind; pointer?: string }

const KIND_CLASS: Record<TokenKind, string> = {
  key: 'text-t-key',
  str: 'text-t-str',
  num: 'text-t-num',
  bool: 'text-t-bool',
  null: 'text-t-null',
  punc: 'text-t-punc',
  ws: '',
}

const escapePointer = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1')

type Frame = { type: 'o' | 'a'; key: string; index: number; expectKey: boolean }

/**
 * Splits JSON text into coloured tokens, tracking the RFC 6901 JSON Pointer of every value so a
 * provenance map (keyed by pointer, as produced by generate()) can mark individual leaves.
 * Works on the text, so the key order of the source is exactly what is displayed.
 */
export function tokenizeJson(src: string): Token[] {
  const out: Token[] = []
  const stack: Frame[] = []
  const pointer = () =>
    stack.map((f) => (f.type === 'o' ? '/' + escapePointer(f.key) : '/' + f.index)).join('')
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      let j = i + 1
      while (j < src.length && ' \n\r\t'.includes(src[j]!)) j++
      out.push({ text: src.slice(i, j), kind: 'ws' })
      i = j
    } else if (ch === '{' || ch === '[') {
      out.push({ text: ch, kind: 'punc' })
      stack.push({ type: ch === '{' ? 'o' : 'a', key: '', index: 0, expectKey: ch === '{' })
      i++
    } else if (ch === '}' || ch === ']') {
      out.push({ text: ch, kind: 'punc' })
      stack.pop()
      i++
    } else if (ch === ',') {
      out.push({ text: ch, kind: 'punc' })
      const top = stack[stack.length - 1]
      if (top?.type === 'a') top.index++
      else if (top) top.expectKey = true
      i++
    } else if (ch === ':') {
      out.push({ text: ch, kind: 'punc' })
      const top = stack[stack.length - 1]
      if (top) top.expectKey = false
      i++
    } else if (ch === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
      const text = src.slice(i, j + 1)
      const top = stack[stack.length - 1]
      if (top?.type === 'o' && top.expectKey) {
        try {
          top.key = JSON.parse(text) as string
        } catch {
          top.key = text.slice(1, -1)
        }
        out.push({ text, kind: 'key' })
      } else {
        out.push({ text, kind: 'str', pointer: pointer() })
      }
      i = j + 1
    } else {
      let j = i
      while (j < src.length && !' \n\r\t,]}:'.includes(src[j]!)) j++
      const text = src.slice(i, j)
      const kind: TokenKind =
        text === 'null' ? 'null' : text === 'true' || text === 'false' ? 'bool' : 'num'
      out.push({ text, kind, pointer: pointer() })
      i = j
    }
  }
  return out
}

const GENERATED = 'border-b border-dashed border-signal-line pb-px'
const PINNED = 'rounded-[3px] bg-signal/14 px-0.5'

export type JsonViewProps = Omit<HTMLAttributes<HTMLPreElement>, 'children'> & {
  /** JSON text, exactly as generate() returns it. Takes precedence over `value`. */
  json?: string
  /** Any JSON value; serialised with 2-space indent. */
  value?: unknown
  /** JSON Pointer to provenance. `generated` leaves are underlined; `fixed` and `preset` leaves are filled. */
  provenance?: Record<string, Provenance>
}

export function JsonView({ json, value, provenance, className, ...props }: JsonViewProps) {
  const text = json ?? JSON.stringify(value, null, 2) ?? 'null'
  const tokens = useMemo(() => tokenizeJson(text), [text])
  return (
    <Slab className={cn('whitespace-pre', className)} {...props}>
      {tokens.map((t, idx) => {
        const prov = t.pointer !== undefined ? provenance?.[t.pointer] : undefined
        const mark =
          prov === 'generated' ? GENERATED : prov === 'fixed' || prov === 'preset' ? PINNED : ''
        if (!KIND_CLASS[t.kind] && !mark) return <Fragment key={idx}>{t.text}</Fragment>
        return (
          <span
            key={idx}
            className={cn(KIND_CLASS[t.kind], mark)}
            {...(prov && mark ? { 'data-provenance': prov } : {})}
          >
            {t.text}
          </span>
        )
      })}
    </Slab>
  )
}
