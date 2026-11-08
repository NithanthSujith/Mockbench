import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge our token names so `text-ink-2` (colour) and `text-control` (size) are not confused.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'bg',
        'panel',
        'panel-2',
        'panel-3',
        'slab',
        'ink',
        'ink-2',
        'ink-3',
        'line',
        'line-strong',
        'slab-line',
        'btn',
        'btn-ink',
        'signal',
        'signal-soft',
        'signal-line',
        'focus',
        'good',
        'warn',
        'bad',
        'info',
        'm-get',
        'm-post',
        'm-put',
        'm-patch',
        'm-delete',
        't-key',
        't-str',
        't-num',
        't-bool',
        't-null',
        't-punc',
      ],
      text: ['micro', 'eyebrow', 'tiny', 'small', 'compact', 'control', 'body', 'lead', 'title'],
      radius: ['xs', 'sm', 'md', 'lg', 'xl', 'full'],
      shadow: ['menu', 'toast'],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
