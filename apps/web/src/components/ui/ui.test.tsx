import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import {
  Button,
  CaseTabs,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  DropdownButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  JsonView,
  LivePill,
  MethodBadge,
  OptionCard,
  Segmented,
  Select,
  Spinner,
  StatusCode,
  Textarea,
  ToastProvider,
  buttonVariants,
  cn,
  tokenizeJson,
  useToast,
} from './index'
import { Gallery } from './gallery'

describe('Button', () => {
  it('renders primary, ghost and dashed variants with distinct token classes', () => {
    expect(buttonVariants({ variant: 'primary' })).toContain('bg-btn')
    expect(buttonVariants({ variant: 'ghost' })).toContain('bg-panel')
    expect(buttonVariants({ variant: 'dashed' })).toContain('border-dashed')
  })
  it('sm is smaller than md', () => {
    expect(buttonVariants({ size: 'sm' })).toContain('text-compact')
    expect(buttonVariants({ size: 'md' })).toContain('text-control')
  })
  it('defaults to type=button so it never submits a form by accident', () => {
    render(<Button>Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button')
  })
  it('a disabled button cannot be clicked or focused by Tab', async () => {
    const user = userEvent.setup()
    let clicks = 0
    render(
      <Button disabled onClick={() => clicks++}>
        Nope
      </Button>,
    )
    await user.click(screen.getByRole('button'))
    await user.tab()
    expect(clicks).toBe(0)
    expect(screen.getByRole('button')).not.toHaveFocus()
  })
})

describe('cn (tailwind-merge with our tokens)', () => {
  it('lets a later colour token win over an earlier one', () => {
    expect(cn('text-ink-2', 'text-ink')).toBe('text-ink')
  })
  it('does not treat a custom font-size token as a colour', () => {
    const merged = cn('text-ink-2 text-control', 'text-compact')
    expect(merged).toContain('text-ink-2')
    expect(merged).toContain('text-compact')
    expect(merged).not.toContain('text-control')
  })
})

describe('badges', () => {
  it('gives each HTTP method its own token colour', () => {
    const expected = {
      GET: 'text-m-get',
      POST: 'text-m-post',
      PUT: 'text-m-put',
      PATCH: 'text-m-patch',
      DELETE: 'text-m-delete',
    }
    for (const [method, cls] of Object.entries(expected)) {
      const { unmount } = render(<MethodBadge method={method} />)
      expect(screen.getByText(method)).toHaveClass(cls, 'mono')
      unmount()
    }
  })
  it('upper-cases the method and falls back to a neutral colour for unknown ones', () => {
    render(<MethodBadge method="options" />)
    expect(screen.getByText('OPTIONS')).toHaveClass('text-ink-2')
  })
  it('tints status codes by class: 2xx good, 4xx warn, 5xx bad', () => {
    render(
      <>
        <StatusCode code={200} />
        <StatusCode code={404} />
        <StatusCode code={500} />
      </>,
    )
    expect(screen.getByText('200')).toHaveClass('text-good')
    expect(screen.getByText('200')).toHaveAttribute('data-status-class', '2xx')
    expect(screen.getByText('404')).toHaveClass('text-warn')
    expect(screen.getByText('500')).toHaveClass('text-bad')
    expect(screen.getByText('500')).toHaveAttribute('data-status-class', '5xx')
  })
  it('renders the live pill', () => {
    render(<LivePill>LIVE v3</LivePill>)
    expect(screen.getByText('LIVE v3')).toHaveClass('text-good')
  })
})

describe('Field', () => {
  it('ties label, control and error together for assistive tech', () => {
    render(
      <Field label="Slug" error="Already taken">
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText('Slug')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Already taken')
    expect(input.getAttribute('aria-describedby')).toBe(alert.id)
  })
  it('has no aria-invalid and shows the hint when there is no error', () => {
    render(
      <Field label="Name" hint="Shown in the project list">
        <Input />
      </Field>,
    )
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText('Shown in the project list')).toBeInTheDocument()
  })
  it('works for Textarea and Select too', () => {
    render(
      <>
        <Field label="Notes">
          <Textarea />
        </Field>
        <Field label="Method" error="Pick one">
          <Select>
            <option>GET</option>
          </Select>
        </Field>
      </>,
    )
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('Method')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Segmented and CaseTabs', () => {
  function Harness() {
    const [v, setV] = useState('builder')
    return (
      <Segmented
        label="View"
        value={v}
        onValueChange={setV}
        items={[
          { value: 'builder', label: 'Builder' },
          { value: 'json', label: 'JSON' },
        ]}
      />
    )
  }
  it('switches the selected tab by click and by arrow key', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByRole('tab', { name: 'Builder' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'JSON' }))
    expect(screen.getByRole('tab', { name: 'JSON' })).toHaveAttribute('aria-selected', 'true')
    screen.getByRole('tab', { name: 'JSON' }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Builder' })).toHaveAttribute('aria-selected', 'true')
  })
  it('CaseTabs shows status chips and marks the default case', () => {
    render(
      <CaseTabs
        value="a"
        onValueChange={() => {}}
        items={[
          { value: 'a', name: 'Found', statusCode: 200, isDefault: true },
          { value: 'b', name: 'Not found', statusCode: 404 },
        ]}
      />,
    )
    const found = screen.getByRole('tab', { name: /Found/ })
    expect(within(found).getByText('200')).toBeInTheDocument()
    expect(within(found).getByLabelText('Default case')).toBeInTheDocument()
    expect(
      within(screen.getByRole('tab', { name: /Not found/ })).queryByLabelText('Default case'),
    ).toBeNull()
  })
})

describe('OptionCard', () => {
  it('is a labelled radio that can be chosen by clicking its text', async () => {
    const user = userEvent.setup()
    render(
      <>
        <OptionCard name="m" title="Deterministic" description="Baked at publish" defaultChecked />
        <OptionCard name="m" title="Random" description="Fresh per request" />
      </>,
    )
    await user.click(screen.getByText('Fresh per request'))
    expect(screen.getByRole('radio', { name: /Random/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Deterministic/ })).not.toBeChecked()
  })
})

describe('Dialog', () => {
  function DialogHarness() {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent title="New project" description="Pick a slug">
          <Field label="Name">
            <Input />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  it('is named by its title, moves focus inside, traps Tab, and closes on Escape restoring focus', async () => {
    const user = userEvent.setup()
    render(
      <>
        <DialogHarness />
        <button>Outside</button>
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))

    // Tab many times: focus must never leave the dialog.
    for (let i = 0; i < 8; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('closes from the close button too', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('DropdownMenu', () => {
  function MenuHarness({ onPick }: { onPick?: () => void }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <DropdownButton>Alps Chemicals</DropdownButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem selected onSelect={onPick}>
            Alps Chemicals
          </DropdownMenuItem>
          <DropdownMenuItem>Side projects</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  it('opens from the keyboard, moves between items with arrows, closes on Escape and restores focus', async () => {
    const user = userEvent.setup()
    render(<MenuHarness />)
    const trigger = screen.getByRole('button', { name: /Alps Chemicals/ })
    trigger.focus()
    await user.keyboard('{Enter}')

    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement))
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    expect(within(menu).getByLabelText('Selected')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}')
    expect(menu).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('selecting an item runs its handler and closes the menu', async () => {
    const user = userEvent.setup()
    let picked = 0
    render(<MenuHarness onPick={() => picked++} />)
    screen.getByRole('button', { name: /Alps Chemicals/ }).focus()
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('menuitem', { name: /^Alps Chemicals/ }))
    expect(picked).toBe(1)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})

describe('keyboard reachability', () => {
  it('every enabled interactive component is reachable by Tab, and disabled ones are skipped', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Button>btn</Button>
        <Button disabled>disabled-btn</Button>
        <IconButton aria-label="icon" />
        <Input aria-label="input" />
        <Textarea aria-label="textarea" />
        <Select aria-label="select">
          <option>a</option>
        </Select>
        <Segmented
          label="seg"
          value="a"
          onValueChange={() => {}}
          items={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />
        <OptionCard name="o" title="opt" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <DropdownButton>menu</DropdownButton>
          </DropdownMenuTrigger>
        </DropdownMenu>
      </>,
    )
    const visited = new Set<string>()
    for (let i = 0; i < 12; i++) {
      await user.tab()
      const el = document.activeElement as HTMLElement
      visited.add(el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
    }
    for (const expected of ['btn', 'icon', 'input', 'textarea', 'select', 'A', 'menu']) {
      expect(visited).toContain(expected)
    }
    expect([...visited].some((v) => v.includes('opt'))).toBe(true) // the radio input inside the card
    expect(visited).not.toContain('disabled-btn')
  })
})

describe('Toast', () => {
  function Trigger() {
    const { toast } = useToast()
    return <button onClick={() => toast('Copied')}>copy</button>
  }
  it('shows the message after toast() is called', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'copy' }))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })
  it('useToast outside a provider throws a clear error', () => {
    function Bad() {
      useToast()
      return null
    }
    expect(() => render(<Bad />)).toThrow(/ToastProvider/)
  })
})

describe('small presentational components', () => {
  it('Spinner is announced as a status with a label', () => {
    render(<Spinner label="Saving" />)
    expect(screen.getByRole('status', { name: 'Saving' })).toBeInTheDocument()
  })
  it('EmptyState shows title, description and action', () => {
    render(
      <EmptyState
        title="No routes yet"
        description="Add one"
        action={<Button>New route</Button>}
      />,
    )
    expect(screen.getByText('No routes yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New route' })).toBeInTheDocument()
  })
})

describe('JsonView', () => {
  const json =
    '{\n  "id": "x-1",\n  "currency": "INR",\n  "n": 1,\n  "ok": true,\n  "none": null,\n  "200": "ordered"\n}'

  it('shows the JSON text exactly, preserving key order (numeric-like keys stay in place)', () => {
    const { container } = render(<JsonView json={json} />)
    expect(container.textContent).toBe(json)
    expect(container.textContent!.indexOf('"id"')).toBeLessThan(
      container.textContent!.indexOf('"200"'),
    )
  })

  it('underlines generated leaves with the dashed signal border and fills fixed and preset leaves', () => {
    render(
      <JsonView
        json={json}
        provenance={{
          '/id': 'generated',
          '/currency': 'preset',
          '/ok': 'fixed',
          '/200': 'example',
        }}
      />,
    )
    const generated = screen.getByText('"x-1"')
    expect(generated).toHaveAttribute('data-provenance', 'generated')
    expect(generated).toHaveClass('border-dashed', 'border-signal-line')

    const preset = screen.getByText('"INR"')
    expect(preset).toHaveAttribute('data-provenance', 'preset')
    expect(preset).toHaveClass('bg-signal/14')

    const fixed = screen.getByText('true')
    expect(fixed).toHaveAttribute('data-provenance', 'fixed')
    expect(fixed).toHaveClass('bg-signal/14')
  })

  it('leaves unmarked and other-provenance leaves plain, and never marks keys', () => {
    render(<JsonView json={json} provenance={{ '/200': 'example', '/id': 'generated' }} />)
    expect(screen.getByText('"ordered"')).not.toHaveAttribute('data-provenance')
    expect(screen.getByText('1')).not.toHaveAttribute('data-provenance')
    expect(screen.getByText('"id"')).not.toHaveAttribute('data-provenance')
  })

  it('colours tokens by type using the t-* tokens', () => {
    render(<JsonView json={json} />)
    expect(screen.getByText('"id"')).toHaveClass('text-t-key')
    expect(screen.getByText('"x-1"')).toHaveClass('text-t-str')
    expect(screen.getByText('1')).toHaveClass('text-t-num')
    expect(screen.getByText('true')).toHaveClass('text-t-bool')
    expect(screen.getByText('null')).toHaveClass('text-t-null')
  })

  it('serialises a value prop with two-space indent', () => {
    const { container } = render(<JsonView value={{ a: [1, 2] }} />)
    expect(container.textContent).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
  })

  it('matches nested array and escaped-key pointers', () => {
    render(<JsonView json={'{"a/b":[{"c":"deep"}]}'} provenance={{ '/a~1b/0/c': 'fixed' }} />)
    expect(screen.getByText('"deep"')).toHaveAttribute('data-provenance', 'fixed')
  })

  it('handles a root primitive (pointer is the empty string)', () => {
    render(<JsonView json={'"hello"'} provenance={{ '': 'generated' }} />)
    expect(screen.getByText('"hello"')).toHaveAttribute('data-provenance', 'generated')
  })

  it('tokenizeJson reproduces its input for tricky strings', () => {
    for (const src of [
      '{"q":"a \\"quoted\\" word","u":"\\u00e9","e":""}',
      '[1,-2.5e3,true,false,null,[],{}]',
      '  {\n"k" :  "v" }\n',
      '"just a string"',
      '42',
    ]) {
      expect(
        tokenizeJson(src)
          .map((t) => t.text)
          .join(''),
      ).toBe(src)
    }
  })
})

describe('Gallery', () => {
  it('renders every component family, all five methods and all three status classes', () => {
    render(
      <ToastProvider>
        <Gallery />
      </ToastProvider>,
    )
    for (const heading of [
      'Buttons',
      'Form controls',
      'Badges and chips',
      'Tabs',
      'Table',
      'Code and JSON',
      'Overlays',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(screen.getAllByText(m).length).toBeGreaterThan(0)
    }
    const classes = new Set(
      Array.from(document.querySelectorAll('[data-status-class]')).map((n) =>
        n.getAttribute('data-status-class'),
      ),
    )
    expect(classes).toEqual(new Set(['2xx', '4xx', '5xx']))
    expect(screen.getByTestId('mono-sample')).toHaveClass('mono')
  })
  it('shows disabled and error states', () => {
    render(
      <ToastProvider>
        <Gallery />
      </ToastProvider>,
    )
    expect(
      screen
        .getAllByRole('button', { name: /Disabled/ })
        .every((b) => (b as HTMLButtonElement).disabled),
    ).toBe(true)
    expect(document.querySelector('[aria-invalid="true"]')).not.toBeNull()
  })
})
