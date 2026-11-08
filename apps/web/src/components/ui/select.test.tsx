import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Field } from './field'
import { Select, SelectGroup, SelectItem, SelectLabel, SelectSeparator } from './select'

function Methods(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  return (
    <Select aria-label="Method" {...props}>
      <SelectItem value="GET">GET</SelectItem>
      <SelectItem value="POST">POST</SelectItem>
      <SelectItem value="DELETE" disabled>
        DELETE
      </SelectItem>
    </Select>
  )
}

describe('Select (themed, Radix)', () => {
  it('renders a combobox trigger showing the selected value, not a native <select>', () => {
    render(<Methods defaultValue="POST" />)
    const trigger = screen.getByRole('combobox', { name: 'Method' })
    expect(trigger).toHaveTextContent('POST')
    expect(document.querySelector('select')).toBeNull()
  })

  it('shows the placeholder while nothing is selected', () => {
    render(<Methods placeholder="Choose a method" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Choose a method')
  })

  it('opens on click into a listbox styled with panel tokens, and marks the selected option', async () => {
    const user = userEvent.setup()
    render(<Methods defaultValue="GET" />)
    await user.click(screen.getByRole('combobox'))
    const list = await screen.findByRole('listbox')
    // Same surface treatment as DropdownMenuContent: panel, strong border, menu shadow.
    expect(list.className).toMatch(/\bbg-panel\b/)
    expect(list.className).toMatch(/\bborder-line-strong\b/)
    expect(list.className).toMatch(/\bshadow-menu\b/)
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['GET', 'POST', 'DELETE'])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]?.querySelector('svg')).not.toBeNull() // check mark
    expect(options[1]?.querySelector('svg')).toBeNull()
  })

  it('choosing an option calls onValueChange, closes the list and updates the trigger', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    function Controlled() {
      const [v, setV] = useState('GET')
      return (
        <Methods
          value={v}
          onValueChange={(x) => {
            onValueChange(x)
            setV(x)
          }}
        />
      )
    }
    render(<Controlled />)
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'POST' }))
    expect(onValueChange).toHaveBeenCalledWith('POST')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('combobox')).toHaveTextContent('POST')
  })

  it('works from the keyboard: Enter opens, arrows move, Enter selects, focus returns to the trigger', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Methods defaultValue="GET" onValueChange={onValueChange} />)
    await user.tab()
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    await screen.findByRole('listbox')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onValueChange).toHaveBeenCalledWith('POST')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('Escape closes the list without changing the value and restores focus', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Methods defaultValue="GET" onValueChange={onValueChange} />)
    await user.click(screen.getByRole('combobox'))
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onValueChange).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox')).toHaveFocus()
  })

  it('a disabled option cannot be chosen; a disabled select does not open', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const { unmount } = render(<Methods defaultValue="GET" onValueChange={onValueChange} />)
    await user.click(screen.getByRole('combobox'))
    const del = await screen.findByRole('option', { name: 'DELETE' })
    expect(del).toHaveAttribute('aria-disabled', 'true')
    await user.click(del)
    expect(onValueChange).not.toHaveBeenCalled()
    unmount()

    render(<Methods disabled />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('is labelled and flagged invalid through <Field>', () => {
    render(
      <Field label="Status" error="Pick one">
        <Select>
          <SelectItem value="200">200</SelectItem>
        </Select>
      </Field>,
    )
    const trigger = screen.getByLabelText('Status')
    expect(trigger).toHaveAttribute('role', 'combobox')
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
  })

  it('submits its value with a surrounding form when given a name', async () => {
    const user = userEvent.setup()
    let data: FormData | undefined
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault()
          data = new FormData(e.currentTarget)
        }}
      >
        <Methods name="method" defaultValue="POST" />
        <button type="submit">go</button>
      </form>,
    )
    await user.click(screen.getByRole('button', { name: 'go' }))
    expect(data?.get('method')).toBe('POST')
  })

  it('mono applies to the trigger and to the options', async () => {
    const user = userEvent.setup()
    render(<Methods mono defaultValue="GET" />)
    const trigger = screen.getByRole('combobox')
    expect(trigger.className).toMatch(/\bmono\b/)
    await user.click(trigger)
    const option = await screen.findByRole('option', { name: 'POST' })
    expect(option.className).toMatch(/\bmono\b/)
  })

  it('supports grouped options with labels and separators', async () => {
    const user = userEvent.setup()
    render(
      <Select aria-label="Method">
        <SelectGroup>
          <SelectLabel>Read</SelectLabel>
          <SelectItem value="GET">GET</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Write</SelectLabel>
          <SelectItem value="POST">POST</SelectItem>
        </SelectGroup>
      </Select>,
    )
    await user.click(screen.getByRole('combobox'))
    const list = await screen.findByRole('listbox')
    expect(within(list).getByText('Read')).toBeInTheDocument()
    expect(within(list).getByText('Write')).toBeInTheDocument()
    expect(within(list).getAllByRole('option')).toHaveLength(2)
  })
})
