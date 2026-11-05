# 0009 — Dark mode only
Status: accepted      Date: 2026-11-05

## Context
The prototype is dark-only and defines one coherent token set. A second theme doubles every visual decision and every screenshot.

## Decision
One dark theme. No light mode, no toggle, no `dark:` variants. Tokens live in the Tailwind theme; components reference tokens, never literal colours. `color-scheme: dark` is set globally.

## Consequences
- Half the visual surface to build and test; the JSON/code palette is tuned for dark.
- Users who want light mode do not get it.

## Revisit if
A contributor offers a complete, token-based light theme and accessibility needs demand it.
