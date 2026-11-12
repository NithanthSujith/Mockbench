import type { MockSchema } from '@mockbench/schema-core'
import { EditorView } from '@codemirror/view'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import workedExample from '../../../../../packages/schema-core/fixtures/worked-example.schema.json'
import { checkSchemaText, findJsonErrorOffset, prettySchema } from './json-text'
import { SchemaEditor } from './SchemaEditor'
import { createBuilderStore } from './store'

const worked = workedExample as unknown as MockSchema
const corpus = import.meta.glob('../../../../../packages/schema-core/fixtures/**/*.schema.json', {
  eager: true,
  import: 'default',
}) as Record<string, MockSchema>

function setup(value: MockSchema = worked) {
  const onChange = vi.fn()
  const user = userEvent.setup()
  const utils = render(<SchemaEditor value={value} onChange={onChange} debounceMs={20} />)
  return { onChange, user, ...utils }
}

function editor(): EditorView {
  const dom = document.querySelector<HTMLElement>('.cm-editor')
  const view = dom ? EditorView.findFromDOM(dom) : null
  if (!view) throw new Error('no editor')
  return view
}

function setText(text: string) {
  const view = editor()
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  })
}

function blur() {
  act(() => {
    editor().contentDOM.dispatchEvent(new FocusEvent('blur'))
  })
}

async function openJson(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'JSON' }))
}

const envelope = (root: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, components: {}, root, ...extra }, null, 2)

describe('JSON tab', () => {
  it('shows the full envelope and applies an edit on blur to the Builder and onChange', async () => {
    const { user, onChange } = setup()
    await openJson(user)
    const parsed = JSON.parse(editor().state.doc.toString()) as MockSchema
    expect(Object.keys(parsed)).toEqual(expect.arrayContaining(['version', 'components', 'root']))

    setText(envelope({ type: 'object', fields: [{ key: 'renamed', node: { type: 'integer' } }] }))
    blur()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((onChange.mock.calls[0]?.[0] as MockSchema).root).toMatchObject({
      fields: [{ key: 'renamed' }],
    })

    await user.click(screen.getByRole('tab', { name: 'Builder' }))
    expect(screen.getByRole('group', { name: 'renamed' })).toBeInTheDocument()
  })

  it('keeps unsaved text across a tab switch and shows the problem again', async () => {
    const { user, onChange } = setup()
    await openJson(user)
    setText('{"version": 1,\n "root": }')
    await user.click(screen.getByRole('tab', { name: 'Builder' }))
    await openJson(user)
    expect(editor().state.doc.toString()).toBe('{"version": 1,\n "root": }')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports malformed JSON with line and column, keeps the store, and clears when fixed', async () => {
    const { user, onChange } = setup()
    await openJson(user)
    setText('{\n  "version": 1,\n  "root": }')
    blur()
    expect(screen.getByRole('alert')).toHaveTextContent(/Unexpected token .* at line 3, column 11/)
    expect(onChange).not.toHaveBeenCalled()

    setText(prettySchema(worked))
    blur()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lists validator issues as path — message and does not replace the store', async () => {
    const { user, onChange } = setup()
    await openJson(user)
    setText(
      envelope({
        type: 'object',
        fields: [
          { key: 'a', node: { type: 'string' } },
          { key: 'a', node: { type: 'nonsense' } },
        ],
      }),
    )
    blur()
    const list = screen.getByLabelText('Schema problems')
    expect(list.querySelectorAll('li').length).toBeGreaterThanOrEqual(2)
    expect(list.textContent).toMatch(/root\.fields\[1\]\S* — /)
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'Builder' }))
    expect(screen.getByRole('group', { name: 'id' })).toBeInTheDocument()
  })

  it('preserves source and unknown keys through Builder, JSON, Builder', async () => {
    const withSource: MockSchema = {
      version: 1,
      components: {},
      root: {
        type: 'object',
        fields: [
          {
            key: 'id',
            node: { type: 'string', source: { from: 'path', name: 'id' }, 'x-vendor': [1, 2] },
          },
        ],
      },
    } as unknown as MockSchema
    const { user, onChange } = setup(withSource)
    await openJson(user)
    setText(editor().state.doc.toString().replace('"id"', '"id"') + '\n')
    blur()
    // Equal schema: nothing to emit.
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'Builder' }))
    await openJson(user)
    expect(JSON.stringify(JSON.parse(editor().state.doc.toString()))).toBe(
      JSON.stringify(withSource),
    )
  })

  it('infers a schema from an example, flags nulls, shows the notice and opens the Builder', async () => {
    const { user, onChange } = setup()
    await openJson(user)
    await user.click(screen.getByRole('button', { name: 'Infer from example' }))
    fireEvent.change(screen.getByLabelText('Example JSON'), {
      target: { value: '{"role":"admin","tags":["a","b"],"meta":null}' },
    })
    await user.click(screen.getByRole('button', { name: 'Infer schema' }))
    expect(screen.getByRole('note')).toHaveTextContent(
      'Inference is a starting point — check the types.',
    )
    const items = within(screen.getByRole('list', { name: 'Inferred fields' }))
      .getAllByRole('listitem')
      .map((i) => i.textContent)
    expect(items).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^role\s*string/),
        expect.stringMatching(/^tags\s*array count 2/),
        expect.stringMatching(/^meta\s*string nullableReal type unknown \(was null\)/),
      ]),
    )
    await user.click(screen.getByRole('button', { name: 'Use this schema' }))
    expect(screen.getByRole('tab', { name: 'Builder' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('group', { name: 'meta' })).toBeInTheDocument()
    expect(screen.getByText('Real type unknown (was null)')).toBeInTheDocument()
    const emitted = onChange.mock.calls.at(-1)?.[0] as MockSchema
    expect(emitted.root).toMatchObject({ type: 'object' })
  })

  it('does not replace the schema when the sample exceeds the node limit', async () => {
    const { user, onChange } = setup()
    await openJson(user)
    await user.click(screen.getByRole('button', { name: 'Infer from example' }))
    const wide = JSON.stringify(
      Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [`k${i}`, i])),
    )
    fireEvent.change(screen.getByLabelText('Example JSON'), { target: { value: wide } })
    await user.click(screen.getByRole('button', { name: 'Infer schema' }))
    expect(screen.getByText(/too large to infer/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use this schema' })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports a syntax error in the example', async () => {
    const { user } = setup()
    await openJson(user)
    await user.click(screen.getByRole('button', { name: 'Infer from example' }))
    fireEvent.change(screen.getByLabelText('Example JSON'), { target: { value: '{"a": }' } })
    await user.click(screen.getByRole('button', { name: 'Infer schema' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/line 1, column 7/)
  })
})

describe('JSON error locator', () => {
  it('agrees with JSON.parse on valid and invalid text and points at the first bad character', () => {
    for (const ok of ['{}', '[]', ' [1, -2.5e3, "a\u00e9", true, null, {"a": [ ]}] ', '0', '"x"']) {
      expect(findJsonErrorOffset(ok), ok).toBeNull()
    }
    const bad: [string, number][] = [
      ['{"a": }', 6],
      ['{"a" 1}', 5],
      ['[1,]', 3],
      ['[1 2]', 3],
      ['{"a": 1,}', 8],
      ['{,}', 1],
      ['01', 1],
      ['[', 1],
      ['{"a": tru}', 6],
      ['{} x', 3],
    ]
    for (const [text, at] of bad) {
      expect(() => JSON.parse(text), text).toThrow()
      expect(findJsonErrorOffset(text), text).toBe(at)
    }
  })
})

describe('round trips', () => {
  it('is lossless for the whole schema-core fixture corpus', () => {
    const entries = Object.entries(corpus)
    expect(entries.length).toBeGreaterThan(5)
    for (const [name, schema] of entries) {
      const store = createBuilderStore(schema)
      const text = prettySchema(store.getState().toSchema())
      const checked = checkSchemaText(text)
      expect(checked.ok, name).toBe(true)
      if (!checked.ok) continue
      const second = createBuilderStore(checked.schema)
      expect(JSON.stringify(second.getState().toSchema()), name).toBe(
        JSON.stringify(store.getState().toSchema()),
      )
    }
  })

  it('loads and parses a 2,000-node schema in under 200 ms', () => {
    const big: MockSchema = {
      version: 1,
      components: {},
      root: {
        type: 'object',
        fields: Array.from({ length: 1999 }, (_, i) => ({
          key: `field${i}`,
          node: { type: 'string' },
        })),
      },
    } as unknown as MockSchema
    const store = createBuilderStore(big)
    const text = prettySchema(store.getState().toSchema())
    const start = performance.now()
    const checked = checkSchemaText(text)
    expect(checked.ok).toBe(true)
    if (checked.ok) store.getState().replaceAll(checked.schema)
    store.getState().toSchema()
    expect(performance.now() - start).toBeLessThan(200)
  })
})
