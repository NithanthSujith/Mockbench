import { Link } from '@tanstack/react-router'

/** The Mockbench mark, from the prototype. Uses currentColor so it follows the text token. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <rect
        x="1.2"
        y="1.2"
        width="17.6"
        height="17.6"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M5.5 13.2V6.8l2.4 3.1 2.1-3.1v6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="14" cy="12.4" r="1.5" fill="currentColor" />
    </svg>
  )
}

export function Brand() {
  return (
    <Link
      to="/"
      className="mr-1 flex items-center gap-2 text-lead font-bold tracking-tight text-ink no-underline"
    >
      <BrandMark />
      Mockbench
    </Link>
  )
}
