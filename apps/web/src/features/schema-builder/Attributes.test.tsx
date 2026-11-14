import type { MockNode, MockSchema } from '@mockbench/schema-core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api/errors'
import { cyclicComponents, renameRefs } from './attr-utils'
import { SchemaBuilder, type SchemaBuilderProps } from './SchemaBuilder'

const schemaOf = (fields: [string, MockNode][], components = {}): MockSchema => ({
  version: 1,
  components,
  root: { type: 'object', fields: fields.map(([key, node]) => ({ key, node })) },
})

const rowOf = (label: string) => screen.getByRole('group', { name: label })

function setup(value: MockSchema, props: Partial<SchemaBuilderProps> = {}) {
  const onChange = vi.fn()
  const user = userEvent.setup()
  const utils = render(
    <SchemaBuilder value={value} onChange={onChange} debounceMs={20} {...props} />,
  )
  const last = () => onChange.mock.calls.at(-1)?.[0] as MockSchema
  return { onChange, user, last, ...utils }
}

async function settle(ms = 80) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

const fieldNode = (schema: MockSchema, key: string) =>
  schema.root.fields?.find((f) => f.key === key)?.node as MockNode

describe('pinning', () => {
  it('pins an integer at 0, stores fixed: 0 and removes the key on unpin', async () => {
    const { user, last } = setup(schemaOf([['age', { type: 'integer' }]]))
    await user.click(within(rowOf('age')).getByRole('button', { name: 'Pin value for age' }))
    await settle()
    expect(fieldNode(last(), 'age')).toEqual({ type: 'integer', fixed: 0 })
    const input = within(rowOf('age')).getByRole('spinbutton', { name: 'Pinned value for age' })
    expect(input).toHaveValue(0)
    expect(input).toHaveClass('bg-signal-soft', 'border-signal-line')
    fireEvent.change(input, { target: { value: '42' } })
    await settle()
    expect(fieldNode(last(), 'age')).toEqual({ type: 'integer', fixed: 42 })
    await user.click(within(rowOf('age')).getByRole('button', { name: 'Unpin age' }))
    await settle()
    expect(Object.keys(fieldNode(last(), 'age'))).toEqual(['type'])
  })

  it('offers a true/false choice for a boolean and text for a string', async () => {
    const { user, last } = setup(
      schemaOf([
        ['ok', { type: 'boolean' }],
        ['title', { type: 'string' }],
      ]),
    )
    await user.click(within(rowOf('ok')).getByRole('button', { name: 'Pin value for ok' }))
    expect(
      within(rowOf('ok')).getByRole('combobox', { name: 'Pinned value for ok' }),
    ).toHaveTextContent('false')
    await user.click(within(rowOf('ok')).getByRole('combobox', { name: 'Pinned value for ok' }))
    await user.click(await screen.findByRole('option', { name: 'true' }))
    await user.click(within(rowOf('title')).getByRole('button', { name: 'Pin value for title' }))
    fireEvent.change(
      within(rowOf('title')).getByRole('textbox', { name: 'Pinned value for title' }),
      {
        target: { value: 'Hello' },
      },
    )
    await settle()
    expect(fieldNode(last(), 'ok')).toEqual({ type: 'boolean', fixed: true })
    expect(fieldNode(last(), 'title')).toEqual({ type: 'string', fixed: 'Hello' })
  })

  it('pins null on any leaf', async () => {
    const { user, last } = setup(schemaOf([['title', { type: 'string' }]]))
    await user.click(within(rowOf('title')).getByRole('button', { name: 'Attributes of title' }))
    await user.click(screen.getByRole('button', { name: 'Pin null for title' }))
    await settle()
    expect(fieldNode(last(), 'title')).toEqual({ type: 'string', fixed: null })
    expect(screen.getByTestId('pinned-null')).toBeInTheDocument()
  })
})

describe('attribute panel', () => {
  it('stores nullable, description and examples in order; the description is a tooltip', async () => {
    const { user, last } = setup(schemaOf([['city', { type: 'string' }]]))
    await user.click(within(rowOf('city')).getByRole('button', { name: 'Attributes of city' }))
    await user.click(screen.getByRole('checkbox', { name: 'Nullable for city' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Description for city' }), {
      target: { value: 'Home city' },
    })
    for (const n of [1, 2, 3]) {
      await user.click(screen.getByRole('button', { name: 'Add example for city' }))
      fireEvent.change(screen.getByRole('textbox', { name: `Example ${n} for city` }), {
        target: { value: ['Pune', 'Delhi', 'Goa'][n - 1] },
      })
    }
    await settle()
    expect(fieldNode(last(), 'city')).toMatchObject({
      nullable: true,
      description: 'Home city',
      examples: ['Pune', 'Delhi', 'Goa'],
    })
    expect(rowOf('city')).toHaveAttribute('title', 'Home city')
    await user.click(screen.getByRole('button', { name: 'Remove example 2 for city' }))
    await settle()
    expect(fieldNode(last(), 'city').examples).toEqual(['Pune', 'Goa'])
  })

  it('flags min greater than max on the row and holds the save until it is fixed', async () => {
    const { user, onChange, last } = setup(schemaOf([['n', { type: 'integer', min: 1, max: 9 }]]))
    await user.click(within(rowOf('n')).getByRole('button', { name: 'Attributes of n' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Min for n' }), {
      target: { value: '5' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Max for n' }), {
      target: { value: '1' },
    })
    await settle()
    expect(within(rowOf('n')).getByText('min is greater than max')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Max for n' }), {
      target: { value: '8' },
    })
    await settle()
    expect(within(rowOf('n')).queryByText('min is greater than max')).toBeNull()
    expect(fieldNode(last(), 'n')).toMatchObject({ min: 5, max: 8 })
  })

  it('keeps unknown attributes visible and saves them untouched', async () => {
    const node = { type: 'string', source: { from: 'query' }, 'x-vendor': 1 } as MockNode
    const { user, last } = setup(schemaOf([['q', node]]))
    expect(within(rowOf('q')).getByTestId('extra-attributes')).toHaveTextContent(
      'extra attributes: source, x-vendor',
    )
    await user.click(within(rowOf('q')).getByRole('button', { name: 'Pin value for q' }))
    await settle()
    expect(fieldNode(last(), 'q')).toMatchObject({ source: { from: 'query' }, 'x-vendor': 1 })
  })

  it('shows every attribute read-only to viewers', async () => {
    const { user } = setup(
      schemaOf([['n', { type: 'integer', min: 1, max: 9, fixed: 3, description: 'Count' }]]),
      { readOnly: true },
    )
    expect(
      within(rowOf('n')).getByRole('spinbutton', { name: 'Pinned value for n' }),
    ).toBeDisabled()
    await user.click(within(rowOf('n')).getByRole('button', { name: 'Attributes of n' }))
    expect(screen.getByRole('spinbutton', { name: 'Min for n' })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: 'Min for n' })).toHaveValue(1)
    expect(screen.getByRole('textbox', { name: 'Description for n' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Nullable for n' })).toBeDisabled()
  })
})

describe('refs and components', () => {
  const comps: Record<string, MockNode> = {
    Address: { type: 'object', fields: [{ key: 'city', node: { type: 'string' } }] },
    Loop: { type: 'ref', name: 'Loop' },
  }

  it('lists the components in a select and stores the pick', async () => {
    const { user, last } = setup(schemaOf([['home', { type: 'ref', name: 'Address' }]]), {
      components: comps,
    })
    await user.click(within(rowOf('home')).getByRole('combobox', { name: 'Component for home' }))
    expect(await screen.findByRole('option', { name: 'Address' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Loop' }))
    await settle()
    expect(fieldNode(last(), 'home')).toEqual({ type: 'ref', name: 'Loop' })
  })

  it('starts a new ref on the first component', async () => {
    const { user, last } = setup(schemaOf([['home', { type: 'string' }]]), { components: comps })
    await user.click(within(rowOf('home')).getByRole('combobox', { name: 'Type' }))
    await user.click(await screen.findByRole('option', { name: 'ref' }))
    await settle()
    expect(fieldNode(last(), 'home')).toEqual({ type: 'ref', name: 'Address' })
  })

  it('badges an unknown ref and a ref to a self-referencing component', () => {
    setup(
      schemaOf([
        ['a', { type: 'ref', name: 'Missing' }],
        ['b', { type: 'ref', name: 'Loop' }],
        ['c', { type: 'ref', name: 'Address' }],
      ]),
      { components: comps },
    )
    expect(within(rowOf('a')).getByText(/unknown_ref/)).toBeInTheDocument()
    expect(within(rowOf('b')).getByText(/ref_cycle/)).toBeInTheDocument()
    expect(within(rowOf('c')).queryByText(/unknown_ref|ref_cycle/)).toBeNull()
  })

  it('does not flag refs while the project components are still loading', () => {
    setup(schemaOf([['a', { type: 'ref', name: 'Missing' }]]))
    expect(within(rowOf('a')).queryByText(/unknown_ref/)).toBeNull()
  })

  it('creates a component from an object subtree with one save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { user } = setup(
      schemaOf([
        [
          'address',
          {
            type: 'object',
            fields: [
              { key: 'city', node: { type: 'string', fixed: 'Pune' } },
              { key: 'zip', node: { type: 'string', source: 1 } },
            ],
          },
        ],
      ]),
      { components: {}, onSaveComponents: onSave },
    )
    await user.click(screen.getByRole('button', { name: 'Save address as component' }))
    const name = await screen.findByRole('textbox', { name: 'New component name' })
    expect(name).toHaveValue('Address')
    await user.click(screen.getByRole('button', { name: 'Save as component' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      Address: {
        type: 'object',
        fields: [
          { key: 'city', node: { type: 'string', fixed: 'Pune' } },
          { key: 'zip', node: { type: 'string', source: 1 } },
        ],
      },
    })
  })

  it('shows the server message when a component is still in use and keeps it', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new ApiError(422, 'validation_failed', 'Component "Address" is used by a case.'),
      )
    const { user } = setup(schemaOf([]), {
      components: { Address: comps.Address! },
      onSaveComponents: onSave,
    })
    await user.click(screen.getByRole('button', { name: 'Manage components' }))
    await user.click(await screen.findByRole('button', { name: 'Delete component Address' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Component "Address" is used by a case.',
    )
    expect(screen.getByRole('textbox', { name: 'Name of component Address' })).toBeInTheDocument()
  })

  it('renames a component and its refs in the open case, with a warning', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { user, last } = setup(schemaOf([['home', { type: 'ref', name: 'Address' }]]), {
      components: { Address: comps.Address! },
      onSaveComponents: onSave,
    })
    await user.click(screen.getByRole('button', { name: 'Manage components' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name of component Address' }), {
      target: { value: 'Place' },
    })
    await user.click(screen.getByRole('button', { name: 'Rename Address' }))
    expect(await within(await screen.findByRole('dialog')).findByRole('status')).toHaveTextContent(
      /Other cases that use "Address"/,
    )
    expect(Object.keys(onSave.mock.calls[0]?.[0] as object)).toEqual(['Place'])
    await settle()
    expect(fieldNode(last(), 'home')).toEqual({ type: 'ref', name: 'Place' })
  })

  it('keeps the old name when the server still sees it in use', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'validation_failed', 'in use'))
      .mockResolvedValueOnce(undefined)
    const { user } = setup(schemaOf([['home', { type: 'ref', name: 'Address' }]]), {
      components: { Address: comps.Address! },
      onSaveComponents: onSave,
    })
    await user.click(screen.getByRole('button', { name: 'Manage components' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name of component Address' }), {
      target: { value: 'Place' },
    })
    await user.click(screen.getByRole('button', { name: 'Rename Address' }))
    expect(await within(await screen.findByRole('dialog')).findByRole('status')).toHaveTextContent(
      /was kept/,
    )
    expect(Object.keys(onSave.mock.calls[1]?.[0] as object)).toEqual(['Address', 'Place'])
  })

  it('is read-only for viewers', async () => {
    const { user } = setup(schemaOf([]), {
      components: { Address: comps.Address! },
      readOnly: true,
    })
    await user.click(screen.getByRole('button', { name: 'Manage components' }))
    expect(await screen.findByRole('button', { name: 'Delete component Address' })).toBeDisabled()
    expect(screen.queryByRole('textbox', { name: 'New component name' })).toBeNull()
  })
})

describe('component helpers', () => {
  it('finds self and mutual references only', () => {
    const found = cyclicComponents({
      A: { type: 'ref', name: 'A' },
      B: { type: 'object', fields: [{ key: 'c', node: { type: 'ref', name: 'C' } }] },
      C: { type: 'array', items: { type: 'ref', name: 'B' } },
      D: { type: 'ref', name: 'B' },
    })
    expect([...found].sort()).toEqual(['A', 'B', 'C'])
  })

  it('renames refs without touching anything else', () => {
    const node = {
      type: 'object',
      fields: [{ key: 'name', node: { type: 'ref', name: 'A', 'x-k': 1 } }],
    }
    expect(renameRefs(node, 'A', 'B')).toEqual({
      type: 'object',
      fields: [{ key: 'name', node: { type: 'ref', name: 'B', 'x-k': 1 } }],
    })
  })
})
