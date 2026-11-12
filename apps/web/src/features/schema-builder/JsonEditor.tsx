import { setDiagnostics } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { minimalSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import { jsonEditorTheme } from './codemirror-theme'

export interface JsonEditorProps {
  /** The text the editor opens with. Later changes to this prop are ignored: the editor owns its text. */
  initialText: string
  readOnly?: boolean
  label: string
  /** A position to flag (syntax error), as an offset into the text. */
  errorAt?: { offset: number; message: string } | null
  onChange?: (text: string) => void
  onBlur: (text: string) => void
}

/**
 * CodeMirror 6 over plain text, themed from the tokens. Everything is bundled: no network request for
 * editor assets. Only the document is a prop; the caller reads it back through `onBlur`.
 */
export function JsonEditor({
  initialText,
  readOnly = false,
  label,
  errorAt,
  onChange,
  onBlur,
}: JsonEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const unreported = useRef(false)
  onChangeRef.current = onChange
  onBlurRef.current = onBlur

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const v = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          minimalSetup,
          lineNumbers(),
          jsonEditorTheme,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({
            'aria-label': label,
            'aria-multiline': 'true',
            spellcheck: 'false',
            autocapitalize: 'off',
            autocorrect: 'off',
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              unreported.current = true
              onChangeRef.current?.(u.state.doc.toString())
            }
          }),
          EditorView.domEventHandlers({
            blur: (_e, editor) => {
              unreported.current = false
              onBlurRef.current(editor.state.doc.toString())
            },
          }),
        ],
      }),
    })
    view.current = v
    return () => {
      // Leaving the tab with edits the editor never reported counts as a blur.
      if (unreported.current) onBlurRef.current(v.state.doc.toString())
      v.destroy()
      view.current = null
    }
    // The editor is created once per mount; it owns its text from then on.
  }, [])

  useEffect(() => {
    const v = view.current
    if (!v) return
    const diagnostics = errorAt
      ? [
          {
            from: Math.min(errorAt.offset, v.state.doc.length),
            to: Math.min(errorAt.offset + 1, v.state.doc.length),
            severity: 'error' as const,
            message: errorAt.message,
          },
        ]
      : []
    v.dispatch(setDiagnostics(v.state, diagnostics))
  }, [errorAt])

  return <div ref={host} data-screen="schema-builder/JsonEditor" className="min-w-0" />
}
