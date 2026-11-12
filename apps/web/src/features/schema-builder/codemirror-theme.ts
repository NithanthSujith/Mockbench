import { RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

// The JSON editor's look, built only from the theme tokens (CSS variables), never literal colours.
// Highlighting is a small line tokenizer rather than a grammar: the editor shows JSON only, and this keeps
// the editor to the packages the web app already depends on.

const TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])/g

const mark = {
  key: Decoration.mark({ class: 'cm-t-key' }),
  str: Decoration.mark({ class: 'cm-t-str' }),
  num: Decoration.mark({ class: 'cm-t-num' }),
  bool: Decoration.mark({ class: 'cm-t-bool' }),
  nul: Decoration.mark({ class: 'cm-t-null' }),
  punc: Decoration.mark({ class: 'cm-t-punc' }),
}

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  let done = -1
  for (const { from, to } of view.visibleRanges) {
    let pos = Math.max(from, done + 1)
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      TOKEN.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = TOKEN.exec(line.text)) !== null) {
        const start = line.from + m.index
        if (m[1] !== undefined) {
          if (m[2] !== undefined) {
            builder.add(start, start + m[1].length, mark.key)
            builder.add(start + m[1].length, start + m[0].length, mark.punc)
          } else builder.add(start, start + m[1].length, mark.str)
        } else if (m[3] !== undefined) builder.add(start, start + m[0].length, mark.num)
        else if (m[4] !== undefined) builder.add(start, start + m[0].length, mark.bool)
        else if (m[5] !== undefined) builder.add(start, start + m[0].length, mark.nul)
        else builder.add(start, start + m[0].length, mark.punc)
      }
      done = line.to
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = decorate(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = decorate(update.view)
    }
  },
  { decorations: (v) => v.decorations },
)

const base = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-slab)',
    color: 'var(--color-ink)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12.5px',
    maxHeight: '60vh',
  },
  '&.cm-focused': { outline: '2px solid var(--color-focus)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--color-ink)', padding: '8px 0' },
  '.cm-cursor': { borderLeftColor: 'var(--color-ink)' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-slab)',
    color: 'var(--color-ink-3)',
    border: 'none',
    borderRight: '1px solid var(--color-slab-line)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--color-panel-3)',
  },
  '.cm-t-key': { color: 'var(--color-t-key)' },
  '.cm-t-str': { color: 'var(--color-t-str)' },
  '.cm-t-num': { color: 'var(--color-t-num)' },
  '.cm-t-bool': { color: 'var(--color-t-bool)' },
  '.cm-t-null': { color: 'var(--color-t-null)' },
  '.cm-t-punc': { color: 'var(--color-t-punc)' },
  '.cm-error-mark': {
    textDecoration: 'underline wavy var(--color-bad)',
    backgroundColor: 'var(--color-panel-3)',
  },
})

export const jsonEditorTheme: Extension = [EditorView.darkTheme.of(true), base, highlighter]
