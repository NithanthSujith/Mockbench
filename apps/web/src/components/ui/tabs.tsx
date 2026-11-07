import { Star } from 'lucide-react'
import { Tabs } from 'radix-ui'
import type { ReactNode } from 'react'
import { StatusCode } from './badges'
import { cn } from './cn'

/** Pill-style two or three way switch (Builder | JSON). Semantically a tablist. */
export function Segmented({
  items,
  value,
  onValueChange,
  label,
  className,
}: {
  items: { value: string; label: ReactNode }[]
  value: string
  onValueChange: (value: string) => void
  label: string
  className?: string
}) {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange}>
      <Tabs.List
        aria-label={label}
        className={cn('inline-flex rounded-md border border-line bg-panel-2 p-0.5', className)}
      >
        {items.map((it) => (
          <Tabs.Trigger
            key={it.value}
            value={it.value}
            className="rounded-[5px] px-2.75 py-1 text-compact text-ink-2 transition-ui hover:text-ink data-[state=active]:bg-panel-3 data-[state=active]:text-ink"
          >
            {it.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  )
}

export type CaseTabItem = { value: string; name: string; statusCode: number; isDefault?: boolean }

/** Response-case tabs for the route editor: status chip, name, default star. */
export function CaseTabs({
  items,
  value,
  onValueChange,
  label = 'Response cases',
  trailing,
}: {
  items: CaseTabItem[]
  value: string
  onValueChange: (value: string) => void
  label?: string
  trailing?: ReactNode
}) {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange}>
      <Tabs.List
        aria-label={label}
        className="flex flex-wrap items-center gap-1.25 border-b border-line bg-panel-2 px-3.75 py-2.25"
      >
        {items.map((it) => (
          <Tabs.Trigger
            key={it.value}
            value={it.value}
            className="inline-flex items-center gap-1.75 rounded-sm border border-transparent px-2.5 py-1.5 text-compact text-ink-2 hover:text-ink data-[state=active]:border-line-strong data-[state=active]:bg-panel data-[state=active]:text-ink"
          >
            <StatusCode code={it.statusCode} />
            {it.name}
            {it.isDefault ? (
              <Star aria-label="Default case" className="size-2.5 fill-signal text-signal" />
            ) : null}
          </Tabs.Trigger>
        ))}
        {trailing}
      </Tabs.List>
    </Tabs.Root>
  )
}
