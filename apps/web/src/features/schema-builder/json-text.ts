import type { Issue, MockSchema } from '@mockbench/schema-core'
import { validateSchema } from '@mockbench/schema-core'

export interface ParseError {
  message: string
  line: number
  column: number
  /** Offset into the text, clamped to it. */
  offset: number
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: ParseError }

function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let last = -1
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++
    last = i
  }
  return { line, column: offset - last }
}

const WS = ' \t\n\r'
const NUMBER = /-?(?:0|[1-9]\d+|[1-9])(?:\.\d+)?(?:[eE][+-]?\d+)?/y

/**
 * Where strict JSON first goes wrong, as an offset (the text length for a premature end), or null when
 * the text is valid. Current V8 messages quote the token instead of giving a position, so this finds it.
 * Iterative, so deeply nested text cannot overflow the stack.
 */
export function findJsonErrorOffset(text: string): number | null {
  let i = 0
  const skipWs = () => {
    while (i < text.length && WS.includes(text.charAt(i))) i++
  }
  const readString = (): boolean => {
    i++ // opening quote
    while (i < text.length) {
      const c = text.charAt(i)
      if (c === '"') {
        i++
        return true
      }
      if (c < ' ') return false
      if (c === '\\') {
        i++
        const e = text.charAt(i)
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) return false
          i += 4
        } else if (e === '' || !'"\\/bfnrt'.includes(e)) return false
      }
      i++
    }
    return false
  }
  const readValue = (): boolean => {
    const c = text.charAt(i)
    if (c === '"') return readString()
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) {
        i += word.length
        return true
      }
    }
    NUMBER.lastIndex = i
    const m = NUMBER.exec(text)
    if (!m) return false
    i += m[0].length
    return true
  }

  const stack: string[] = []
  let want: 'value' | 'valueOrClose' | 'key' | 'keyOrClose' | 'after' = 'value'
  skipWs()
  for (;;) {
    if (want === 'after') {
      skipWs()
      const top = stack[stack.length - 1]
      if (top === undefined) return i < text.length ? i : null
      const c = text.charAt(i)
      if (c === ',') {
        i++
        skipWs()
        want = top === '{' ? 'key' : 'value'
      } else if ((c === '}' && top === '{') || (c === ']' && top === '[')) {
        i++
        stack.pop()
      } else return i
    } else if (want === 'key' || want === 'keyOrClose') {
      if (want === 'keyOrClose' && text.charAt(i) === '}') {
        i++
        stack.pop()
        want = 'after'
        continue
      }
      if (text.charAt(i) !== '"' || !readString()) return i
      skipWs()
      if (text.charAt(i) !== ':') return i
      i++
      skipWs()
      want = 'value'
    } else if (want === 'valueOrClose' && text.charAt(i) === ']') {
      i++
      stack.pop()
      want = 'after'
    } else {
      const c = text.charAt(i)
      if (c === '{' || c === '[') {
        i++
        stack.push(c)
        skipWs()
        want = c === '{' ? 'keyOrClose' : 'valueOrClose'
      } else {
        const start = i
        if (!readValue()) return start
        want = 'after'
      }
    }
  }
}

/** JSON.parse with an error that always says where: "Unexpected token '}' at line 4, column 7". */
export function parseJson(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const offset = Math.min(findJsonErrorOffset(text) ?? text.length, text.length)
    const { line, column } = lineColumn(text, offset)
    let what: string
    if (offset >= text.length) what = 'Unexpected end of JSON input'
    else if (/^Unexpected token|^Expected|^Unterminated|^Bad|^Unexpected non/.test(raw)) {
      what = `Unexpected token '${text.charAt(offset)}'`
    } else what = raw.replace(/\s+in JSON at position.*$/s, '')
    return {
      ok: false,
      error: { message: `${what} at line ${line}, column ${column}`, line, column, offset },
    }
  }
}

export function prettySchema(schema: MockSchema): string {
  return JSON.stringify(schema, null, 2)
}

export interface IssueLine {
  path: string
  message: string
}

/** `root.fields[0].node` style path for display; an empty path is the envelope itself. */
export function formatIssuePath(path: Issue['path']): string {
  if (path.length === 0) return '(schema)'
  return path.reduce<string>(
    (acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : seg),
    '',
  )
}

export type CheckResult =
  | { ok: true; schema: MockSchema }
  | { ok: false; kind: 'syntax'; error: ParseError }
  | { ok: false; kind: 'schema'; issues: IssueLine[] }

/** Parse then validate editor text. Never throws. */
export function checkSchemaText(text: string): CheckResult {
  const parsed = parseJson(text)
  if (!parsed.ok) return { ok: false, kind: 'syntax', error: parsed.error }
  const checked = validateSchema(parsed.value)
  if (!checked.ok) {
    return {
      ok: false,
      kind: 'schema',
      issues: checked.issues.map((i) => ({ path: formatIssuePath(i.path), message: i.message })),
    }
  }
  return { ok: true, schema: checked.schema }
}
