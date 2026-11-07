import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from './cn'

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-control', className)} {...props} />
    </div>
  )
}
export const THead = (props: HTMLAttributes<HTMLTableSectionElement>) => <thead {...props} />
export const TBody = (props: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />
export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('hover:bg-panel-2 [&:last-child>td]:border-b-0', className)} {...props} />
  )
}
export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'eyebrow whitespace-nowrap border-b border-line px-3.5 py-2.25 text-left',
        className,
      )}
      {...props}
    />
  )
}
export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('whitespace-nowrap border-b border-line px-3.5 py-2.5', className)}
      {...props}
    />
  )
}
