import { Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { MethodBadge, StatusCode, LivePill } from './badges'
import { Button } from './button'
import { Card, PanelBody, PanelHead } from './card'
import { CaseTabs, Segmented } from './tabs'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from './dialog'
import {
  DropdownButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { Field } from './field'
import { IconButton } from './icon-button'
import { Input, Select, Textarea } from './input'
import { JsonView, type Provenance } from './json-view'
import { EmptyState, Eyebrow, OptionCard, Slab, Spinner } from './misc'
import { Table, TBody, Td, Th, THead, Tr } from './table'
import { useToast } from './toast'

const SAMPLE_JSON = `{
  "id": "8c1f0e2a-5b43-5c9d-9f12-6a7b8c9d0e1f",
  "name": "name-1",
  "currency": "INR",
  "is_active": true,
  "branch_list": ["branch_list-1", "branch_list-2"],
  "address": { "city": "city-1", "pincode": 1 },
  "deleted_at": null
}`

const SAMPLE_PROVENANCE: Record<string, Provenance> = {
  '/id': 'generated',
  '/name': 'generated',
  '/currency': 'preset',
  '/is_active': 'fixed',
  '/branch_list/0': 'generated',
  '/branch_list/1': 'generated',
  '/address/city': 'generated',
  '/address/pincode': 'generated',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <PanelHead>
        <h3>{title}</h3>
      </PanelHead>
      <PanelBody className="flex flex-col gap-4">{children}</PanelBody>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Eyebrow className="w-28 shrink-0">{label}</Eyebrow>
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">{children}</div>
    </div>
  )
}

/** Every component in every variant and state. Mounted at /_dev/ui by FND-13. */
export function Gallery() {
  const { toast } = useToast()
  const [mode, setMode] = useState('builder')
  const [caseId, setCaseId] = useState('found')

  return (
    <div className="mx-auto flex max-w-295 flex-col gap-4 px-4 py-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-title font-bold">Mockbench UI kit</h1>
        <span data-testid="body-sample" className="text-control text-ink-2">
          Archivo for UI text. <span className="mono">IBM Plex Mono</span> for every path, key,
          value and status code.
        </span>
      </header>

      <Section title="Buttons">
        {(['primary', 'ghost', 'dashed'] as const).map((variant) => {
          // The dashed variant is full-width by design; keep the showcase row compact.
          const fit = variant === 'dashed' ? 'w-36' : ''
          return (
            <Row key={variant} label={variant}>
              <Button variant={variant} className={fit}>
                Default
              </Button>
              <Button variant={variant} size="sm" className={fit}>
                Small
              </Button>
              <Button variant={variant} className={`${fit} demo-focus`}>
                Focus-visible
              </Button>
              <Button variant={variant} className={fit} disabled>
                Disabled
              </Button>
              <span className="text-small text-ink-3">hover me</span>
            </Row>
          )
        })}
        <Row label="Icon button">
          <IconButton aria-label="Add">
            <Plus aria-hidden className="size-4" />
          </IconButton>
          <IconButton aria-label="Add (focus-visible)" className="demo-focus">
            <Plus aria-hidden className="size-4" />
          </IconButton>
          <IconButton aria-label="Add (disabled)" disabled>
            <Plus aria-hidden className="size-4" />
          </IconButton>
        </Row>
      </Section>

      <Section title="Form controls">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(15.75rem,1fr))] gap-4">
          <Field label="Email" hint="We never send mail; this is just an identifier.">
            <Input type="email" placeholder="you@example.com" />
          </Field>
          <Field label="Path (mono)">
            <Input mono defaultValue="/invoices/:id" />
          </Field>
          <Field
            label="Slug"
            error="That URL slug is already used by another project on this server."
          >
            <Input mono defaultValue="billing-api" />
          </Field>
          <Field label="Disabled">
            <Input disabled defaultValue="read only" />
          </Field>
          <Field label="Focus-visible">
            <Input className="demo-focus" defaultValue="focused" />
          </Field>
          <Field label="Status code">
            <Select mono defaultValue="200">
              {[200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <Textarea placeholder="Describe what this route returns." />
          </Field>
          <Field label="Select (disabled)">
            <Select disabled defaultValue="GET">
              <option>GET</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(15.75rem,1fr))] gap-3">
          <OptionCard
            name="gallery-mode"
            defaultChecked
            title="Deterministic"
            description="Values come from the key and position. Baked at publish."
          />
          <OptionCard
            name="gallery-mode"
            title="Seeded faker"
            description="Realistic-looking output, stable. Still baked."
          />
          <OptionCard
            type="checkbox"
            defaultChecked
            title="Alps defaults"
            description="currency, city, gstin, sku"
          />
          <OptionCard
            type="checkbox"
            disabled
            title="Disabled option"
            description="Cannot be changed."
          />
        </div>
      </Section>

      <Section title="Badges and chips">
        <Row label="Methods">
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
            <MethodBadge key={m} method={m} />
          ))}
        </Row>
        <Row label="Status 2xx">
          <StatusCode code={200} />
          <StatusCode code={201} />
          <StatusCode code={204} />
        </Row>
        <Row label="Status 4xx">
          <StatusCode code={401} />
          <StatusCode code={404} />
          <StatusCode code={422} />
        </Row>
        <Row label="Status 5xx">
          <StatusCode code={500} />
          <StatusCode code={503} />
        </Row>
        <Row label="Live pill">
          <LivePill>LIVE v3</LivePill>
          <span className="text-small text-ink-2">not published</span>
        </Row>
        <Row label="Eyebrow / spinner">
          <Eyebrow>Generation mode</Eyebrow>
          <Spinner />
        </Row>
      </Section>

      <Section title="Tabs">
        <Row label="Segmented">
          <Segmented
            label="Schema view"
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'builder', label: 'Builder' },
              { value: 'json', label: 'JSON' },
            ]}
          />
        </Row>
        <div className="overflow-hidden rounded-lg border border-line">
          <CaseTabs
            value={caseId}
            onValueChange={setCaseId}
            items={[
              { value: 'found', name: 'Found', statusCode: 200, isDefault: true },
              { value: 'nf', name: 'Not found', statusCode: 404 },
              { value: 'err', name: 'Server error', statusCode: 500 },
            ]}
            trailing={
              <Button variant="dashed" size="sm" className="w-auto">
                + Case
              </Button>
            }
          />
        </div>
      </Section>

      <Section title="Table">
        <div className="overflow-hidden rounded-lg border border-line">
          <Table>
            <THead>
              <Tr>
                <Th>Version</Th>
                <Th>Label</Th>
                <Th>Routes</Th>
                <Th>State</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              <Tr>
                <Td className="num font-semibold">v3</Td>
                <Td className="mono text-compact text-ink-2">pricing-fields-added</Td>
                <Td className="num">6</Td>
                <Td>
                  <LivePill>LIVE</LivePill>
                </Td>
                <Td />
              </Tr>
              <Tr>
                <Td className="num font-semibold">v2</Td>
                <Td className="mono text-compact text-ink-2">before-the-pricing-change</Td>
                <Td className="num">6</Td>
                <Td className="text-ink-2">published</Td>
                <Td className="text-right">
                  <Button variant="ghost" size="sm">
                    Deploy
                  </Button>
                </Td>
              </Tr>
            </TBody>
          </Table>
        </div>
        <EmptyState
          title="Nothing published yet"
          description="Publishing freezes every route and case into a snapshot; deploying points the URL at it."
          action={<Button size="sm">Publish</Button>}
        />
      </Section>

      <Section title="Code and JSON">
        <Slab data-testid="mono-sample">
          curl -i http://192.168.1.24:8080/mock/billing-api/invoices/42
        </Slab>
        <JsonView json={SAMPLE_JSON} provenance={SAMPLE_PROVENANCE} />
        <div className="flex flex-wrap gap-4 text-small text-ink-3">
          <span>
            <span className="border-b border-dashed border-signal-line text-ink-2">name-1</span>{' '}
            generated from the key
          </span>
          <span>
            <span className="rounded-[3px] bg-signal/14 px-0.5 text-signal">INR</span> pinned or
            from a preset
          </span>
        </div>
      </Section>

      <Section title="Overlays">
        <Row label="Dropdown">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <DropdownButton>Alps Chemicals</DropdownButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Workspace</DropdownMenuLabel>
              <DropdownMenuItem selected>Alps Chemicals</DropdownMenuItem>
              <DropdownMenuItem>Side projects</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>+ New workspace</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
        <Row label="Dialog">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost">Open dialog</Button>
            </DialogTrigger>
            <DialogContent
              title="New project"
              description="The slug is the URL prefix and cannot be changed later."
            >
              <Field label="Name">
                <Input placeholder="Billing API" />
              </Field>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Row>
        <Row label="Toast">
          <Button variant="ghost" onClick={() => toast('Copied')}>
            Show toast
          </Button>
        </Row>
      </Section>
    </div>
  )
}
