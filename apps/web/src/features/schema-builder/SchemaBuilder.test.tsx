import type { MockSchema } from '@mockbench/schema-core'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import workedExample from '../../../../../packages/schema-core/fixtures/worked-example.schema.json'
import { SchemaBuilder } from './SchemaBuilder'

const worked = workedExample as unknown as MockSchema

const empty: MockSchema = { version: 1, components: {}, root: { type: 'object', fields: [] } }

function rowOf(label: string): HTMLElement {
  return screen.getByRole('group', { name: label })
}

function setup(
  value: MockSchema = worked,
  props: Partial<React.ComponentProps<typeof SchemaBuilder>> = {},
) {
  const onChange = vi.fn()
  const user = userEvent.setup()
  const utils = render(
    <SchemaBuilder value={value} onChange={onChange} debounceMs={100} {...props} />,
  )
  return { onChange, user, ...utils }
}

async function settle(ms = 250) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

describe('SchemaBuilder rows', () => {
  it('renders the worked example as indented rows', () => {
    setup()
    const rows = screen.getAllByRole('group')
    expect(
      rows.map((r) => [
        r.getAttribute('data-depth'),
        r.getAttribute('aria-label'),
        r.getAttribute('data-kind'),
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "0",
          "id",
          "field",
        ],
        [
          "0",
          "name",
          "field",
        ],
        [
          "0",
          "email",
          "field",
        ],
        [
          "0",
          "role",
          "field",
        ],
        [
          "0",
          "is_active",
          "field",
        ],
        [
          "0",
          "branch_list",
          "field",
        ],
        [
          "1",
          "[ item ]",
          "item",
        ],
        [
          "0",
          "address",
          "field",
        ],
        [
          "1",
          "city",
          "field",
        ],
        [
          "1",
          "pincode",
          "field",
        ],
        [
          "0",
          "orders",
          "field",
        ],
        [
          "1",
          "[ item ]",
          "item",
        ],
        [
          "2",
          "order_id",
          "field",
        ],
        [
          "2",
          "total",
          "field",
        ],
      ]
    `)
    const city = rowOf('city')
    expect(city).toHaveStyle({ paddingLeft: '33px' })
    const key = within(city).getByRole('textbox', { name: 'Field name' })
    expect(key).toHaveValue('city')
    expect(key.className).toContain('mono')
    expect(within(city).getByRole('combobox', { name: 'Type' })).toHaveTextContent('string')
    const branch = rowOf('branch_list')
    expect(within(branch).getByRole('spinbutton')).toHaveValue(3)
    expect(within(branch).getByText('count')).toBeInTheDocument()
  })

  it('renaming a key updates the store and emits the new schema after the debounce, order unchanged', async () => {
    const { onChange, user } = setup(worked, { debounceMs: 400 })
    const key = within(rowOf('name')).getByRole('textbox', { name: 'Field name' })
    await user.clear(key)
    await user.type(key, 'full_name')
    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
    await settle(700)
    expect(onChange).toHaveBeenCalledTimes(1)
    const out = onChange.mock.calls[0]?.[0] as MockSchema
    expect(out.root.fields?.map((f) => f.key).slice(0, 3)).toEqual(['id', 'full_name', 'email'])
  }, 20_000)

  it('Escape reverts a key edit', async () => {
    const { onChange, user } = setup()
    const key = within(rowOf('name')).getByRole('textbox', { name: 'Field name' })
    await user.click(key)
    await user.type(key, 'xyz')
    await user.keyboard('{Escape}')
    expect(key).toHaveValue('name')
    await settle()
    const last = onChange.mock.calls.at(-1)?.[0] as MockSchema | undefined
    if (last) expect(last.root.fields?.[1]?.key).toBe('name')
  })

  it('collapsing hides descendants and is remembered for the session key', async () => {
    const { user, unmount } = setup(worked, { sessionKey: 'case-a' })
    await user.click(screen.getByRole('button', { name: 'Collapse address' }))
    expect(screen.queryByRole('group', { name: 'city' })).toBeNull()
    unmount()
    setup(worked, { sessionKey: 'case-a' })
    expect(screen.queryByRole('group', { name: 'city' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand address' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})

describe('type changes', () => {
  it('confirms before discarding children; Cancel keeps the tree', async () => {
    const { user, onChange } = setup()
    await user.click(within(rowOf('address')).getByRole('combobox', { name: 'Type' }))
    await user.click(await screen.findByRole('option', { name: 'string' }))
    expect(
      await screen.findByText('Switching to string discards 2 child fields'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('group', { name: 'city' })).toBeInTheDocument()
    await settle()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Discard removes the children', async () => {
    const { user, onChange } = setup()
    await user.click(within(rowOf('address')).getByRole('combobox', { name: 'Type' }))
    await user.click(await screen.findByRole('option', { name: 'string' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('group', { name: 'city' })).toBeNull()
    await settle()
    const out = onChange.mock.calls.at(-1)?.[0] as MockSchema
    expect(out.root.fields?.find((f) => f.key === 'address')?.node).toMatchObject({
      type: 'string',
    })
  })

  it('changes a leaf type without asking', async () => {
    const { user } = setup()
    await user.click(within(rowOf('role')).getByRole('combobox', { name: 'Type' }))
    await user.click(await screen.findByRole('option', { name: 'enum' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(rowOf('role')).getByRole('textbox', { name: /Enum values/ })).toHaveValue(
      'one, two, three',
    )
  })
})

describe('fields', () => {
  it('+ on an object appends new_field and focuses its key; non-object rows have no +', async () => {
    const { user } = setup()
    expect(within(rowOf('name')).queryByRole('button', { name: 'Add field' })).toBeNull()
    await user.click(within(rowOf('address')).getByRole('button', { name: 'Add field' }))
    const added = within(rowOf('new_field')).getByRole('textbox', { name: 'Field name' })
    expect(added).toHaveFocus()
    expect(within(rowOf('new_field')).getByRole('combobox', { name: 'Type' })).toHaveTextContent(
      'string',
    )
  })

  it('removes a field; array items have no delete', async () => {
    const { user } = setup()
    const items = screen.getAllByRole('group', { name: '[ item ]' })
    for (const i of items)
      expect(within(i).queryByRole('button', { name: 'Remove field' })).toBeNull()
    await user.click(within(rowOf('pincode')).getByRole('button', { name: 'Remove field' }))
    expect(screen.queryByRole('group', { name: 'pincode' })).toBeNull()
  })

  it('clamps the array count to 0-1000 and warns above 50', async () => {
    const { user, onChange } = setup()
    const count = within(rowOf('branch_list')).getByRole('spinbutton')
    await user.clear(count)
    await user.type(count, '60')
    expect(
      within(rowOf('branch_list')).getByText('large arrays slow the preview'),
    ).toBeInTheDocument()
    await user.clear(count)
    await user.type(count, '5000')
    expect(count).toHaveValue(1000)
    await settle()
    const out = onChange.mock.calls.at(-1)?.[0] as MockSchema
    expect(out.root.fields?.find((f) => f.key === 'branch_list')?.node).toMatchObject({
      count: 1000,
    })
  })

  it('marks sibling duplicate keys and still emits the structure', async () => {
    const { user, onChange } = setup()
    const key = within(rowOf('name')).getByRole('textbox', { name: 'Field name' })
    await user.clear(key)
    await user.type(key, 'id')
    const markers = screen.getAllByText('duplicate key')
    expect(markers).toHaveLength(2)
    await settle()
    expect(onChange).toHaveBeenCalled()
  })

  it('edits enum values as comma text', async () => {
    const { user, onChange } = setup({
      ...worked,
      root: { type: 'object', fields: [{ key: 'status', node: { type: 'enum', values: ['a'] } }] },
    })
    const vals = screen.getByRole('textbox', { name: /Enum values/ })
    await user.clear(vals)
    await user.type(vals, 'x, y,')
    expect(vals).toHaveValue('x, y,')
    await settle()
    const out = onChange.mock.calls.at(-1)?.[0] as MockSchema
    expect(out.root.fields?.[0]?.node).toMatchObject({ values: ['x', 'y'] })
  })
})

describe('roots', () => {
  it('shows an empty-body hint and adds a field', async () => {
    const { user } = setup(empty)
    expect(screen.getByText('This case returns an empty body.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add field' }))
    expect(screen.getByRole('group', { name: 'new_field' })).toBeInTheDocument()
    expect(screen.queryByText('This case returns an empty body.')).toBeNull()
  })

  it('shows [ item ] directly for a root array', () => {
    setup({
      version: 1,
      components: {},
      root: { type: 'array', count: 2, items: { type: 'string' } },
    })
    const rows = screen.getAllByRole('group')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('aria-label', '[ item ]')
    expect(rows[0]).toHaveAttribute('data-depth', '0')
  })
})

describe('keyboard and read-only', () => {
  it('tabs twist, key, type, extra, actions within a row', async () => {
    const { user } = setup()
    within(rowOf('branch_list')).getByRole('button', { name: 'Collapse branch_list' }).focus()
    const order: string[] = []
    for (let i = 0; i < 5; i++) {
      order.push(document.activeElement?.getAttribute('aria-label') ?? '')
      await user.tab()
    }
    expect(order).toEqual([
      'Collapse branch_list',
      'Field name',
      'Type',
      'Array length for branch_list',
      'Remove field',
    ])
  })

  it('disables every control and emits nothing in readOnly mode', async () => {
    const { onChange } = setup(worked, { readOnly: true })
    const row = rowOf('address')
    expect(within(row).getByRole('textbox', { name: 'Field name' })).toBeDisabled()
    expect(within(row).getByRole('combobox', { name: 'Type' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Add field' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Remove field' })).toBeDisabled()
    expect(within(rowOf('branch_list')).getByRole('spinbutton')).toBeDisabled()
    await settle()
    expect(onChange).not.toHaveBeenCalled()
  })
})
