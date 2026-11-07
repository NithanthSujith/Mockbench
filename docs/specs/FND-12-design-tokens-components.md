# FND-12 — Design tokens and component vocabulary

Status: in progress
Phase: 1   Team: Core
Depends on: FND-01
Size: L

## Goal
The prototype's visual language exists once, as the Tailwind theme and a small component kit, so every team builds against the same tokens and nobody writes a hex colour. Dark mode only; Archivo for UI and IBM Plex Mono for every path, key, value, status code and code block, self-hosted.

## In scope
- Extraction of the `:root` token set from `design-reference/prototype.html` into the Tailwind theme (colours, radii, type scale, shadows) and global base styles (`color-scheme: dark`, focus ring, selection, scrollbars, `prefers-reduced-motion`).
- Fonts via `@fontsource/archivo` (400/500/600/700) and `@fontsource/ibm-plex-mono` (400/500/600) imported locally.
- The component vocabulary below, built on shadcn/Radix primitives restyled to the tokens, plus a `Gallery` component. Because the router arrives in FND-13, this unit ships a temporary standalone Vite entry (`apps/web/index.html` + `src/main.tsx` rendering `<Gallery/>`) and the Vite/Tailwind 4 (`@tailwindcss/vite`, CSS-first `@theme`) wiring; FND-13 replaces `main.tsx` with the router and mounts `Gallery` at `/_dev/ui`.

## Out of scope
The app shell and route tree (FND-13). Feature components. Light mode.

## Contract
Token names (Tailwind keys), values from the prototype: surfaces `bg #0C0F13`, `panel #14181E`, `panel-2 #1A1F27`, `panel-3 #222935`, `slab #0E1217`; ink `ink #E8ECF2`, `ink-2 #99A3B1`, `ink-3 #7C8794` (raised from the prototype's `#69737F`, see Open questions); lines `line #242B35`, `line-strong #39424E`, `slab-line #20262F`; action `btn #E8ECF2` on `btn-ink #14171C`; accent `signal #E0B152`, `signal-soft #312513`, `signal-line #6B5422`; status `good #4ADE80`, `warn #E0B152`, `bad #FB7185`, `info #7CA0FF`; methods `m-get #7CA0FF`, `m-post #5DD08A`, `m-put #B79BFF`, `m-patch #56C7D8`, `m-delete #FB7185`; JSON `t-key #9BB4FF`, `t-str #8ED8A8`, `t-num #E8B37A`, `t-bool #C9A2FF`, `t-null #7B8696`, `t-punc #5F6B7C`. Radii 4/6/7/9/11 px; breakpoints 860 and 1240 px (the prototype's); type: UI 14 px/1.5, eyebrow 10.5 px uppercase tracked, mono 12–14 px.
Components (`apps/web/src/components/ui/`): `Button` (primary, ghost, dashed; sm), `IconButton`, `Input`, `Select`, `Textarea`, `Card` + `PanelHead`, `Table`, `MethodBadge`, `StatusCode` (2xx/4xx/5xx tint), `LivePill`, `Segmented`, `DropdownMenu`, `Dialog`, `Toast`, `Slab` (code block), `JsonView` (token-coloured JSON with a provenance underline/fill API), `Eyebrow`, `OptionCard` (radio/checkbox card), `EmptyState`, `Spinner`, `Field` (label + control + error).

## Acceptance criteria
- [x] No colour literal (`#…`, `rgb(`, `hsl(`) exists under `apps/web/src` outside `src/styles/` (the FND-01 lint rule passes with real code).
- [x] `<html>` has `color-scheme: dark`; no `dark:` class and no light theme exists.
- [x] In the gallery, an element with the `mono` utility computes `font-family` starting with `"IBM Plex Mono"`, body text starts with `"Archivo"`, and every network request on page load is same-origin (Playwright asserts no request to any other host, including `fonts.googleapis.com`).
- [x] Measured contrast: `ink` on `bg` ≥ 7:1; `ink-2` on `panel` ≥ 4.5:1; `bad`, `good`, `warn`, `info` on `panel` ≥ 4.5:1; `ink-3` (now `#7C8794`) on `panel` ≥ 4.5:1.
- [x] The gallery renders every component in every variant and state (default, focus-visible, disabled, error; hover is live) and every method badge and status class (asserted by tests).
- [ ] A reviewer's side-by-side of the gallery with the prototype (topbar controls, case tabs, table rows, the Slab) is approved by the user. *(Screenshots at 1440/1000/390 px are in `apps/web/gallery-screenshots/`, git-ignored; regenerate with `pnpm --filter @mockbench/web test:e2e`.)*
- [x] Keyboard: every interactive component is reachable by Tab and shows the `signal` focus ring; `DropdownMenu` and `Dialog` trap and restore focus and close on Escape.
- [x] `JsonView` given a value and a provenance map renders `generated` leaves with the dashed signal underline and `fixed`/`preset` leaves with the soft signal fill (the prototype's `.gen`/`.fix`).

## Implementation notes (clarifications recorded while building)
- **Verified:** 53 Vitest tests (theme tokens and contrast, source hygiene, component behaviour incl. focus trap/restore/Escape on Dialog and DropdownMenu, JsonView provenance, Gallery) and 9 Playwright tests in Chromium (computed fonts, same-origin network, dark-only under a forced light OS preference, focus ring on 21 consecutive tab stops, hover, reduced motion, no horizontal scroll at 360 px, screenshots).
- **Components beyond the list:** `CaseTabs` (the prototype's case tabs), `DropdownButton` (topbar switcher trigger), `ToastProvider`/`useToast`, `PanelBody`, `THead/TBody/Tr/Th/Td`, `useFieldControlProps`. `Select` is a styled native `<select>` (accessible, form-friendly, cheap to render hundreds of times in the builder), not a Radix Select.
- **Tailwind 4:** the theme resets Tailwind's default palette, radii, breakpoints, type and shadows so only Mockbench tokens exist. Breakpoints are `narrow` (860) and `wide` (1240), used as `max-narrow:` / `max-wide:` (the prototype is desktop-first). Utilities: `mono`, `num`, `eyebrow`, `demo-focus`, `transition-ui`. `transition-ui` replaces Tailwind's `transition-colors` because the latter transitions `outline-color`, making the focus ring fade in from the text colour; found by the Playwright focus-ring test.
- **`JsonView`:** takes `json` text (as returned by `generate()`) or a `value`, tokenises the text, and matches RFC 6901 pointers to the provenance map, so key order is exactly what is shown. Only `generated` (dashed underline) and `fixed`/`preset` (soft fill) are styled; `example`, `enum` and `random` are plain.
- **Gallery states:** hover cannot be forced in a browser, so hover is live ("hover me"); focus-visible is forced with the `demo-focus` utility, which shares its rules with the global `:focus-visible` base style.
- **Fonts:** Latin subset only (`latin-400..` files), self-hosted; other scripts fall back to system fonts. Add the `latin-ext` files if accented text matters.
- **Entry and scripts:** temporary `index.html` + `src/main.tsx` render the Gallery inside `ToastProvider` for FND-13 to replace. Scripts: `dev`, `build` (tsc + vite build), `preview`, `test`, `test:e2e`. `tsconfig.node.json` covers the config and e2e files.
- **Test environment:** jsdom 31 pulls undici 8, which needs `zlib.createZstdDecompress` (Node 22.15 or newer). `test-node-shim.mjs`, loaded only into the test workers by `vitest.config.ts`, stubs it so Node 22.12 can run the suite. See Open questions.

## Tests
Vitest + Testing Library for behaviour (focus, escape, variants); one Playwright test for fonts/requests; a contrast unit test computed from the theme file.

## Open questions
- **Resolved 2026-11-07:** `ink-3` is raised from the prototype's `#69737F` (about 3.6:1 on `panel`) to **`#7C8794`** (about 4.9:1) so eyebrows and hints pass AA. All other prototype values are kept. One token, trivially reversible.
- Icon set (prototype uses glyph characters): `lucide-react` used.
- **Node floor:** the jsdom/undici requirement above means the repo really needs Node >=22.15; the root preinstall check (`scripts/check-node.mjs`, Core-owned) only requires 22.x. Raise it, or drop the test shim, when convenient.
