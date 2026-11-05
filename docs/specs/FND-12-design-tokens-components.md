# FND-12 — Design tokens and component vocabulary

Status: approved
Phase: 1   Team: Core
Depends on: FND-01
Size: L

## Goal
The prototype's visual language exists once, as the Tailwind theme and a small component kit, so every team builds against the same tokens and nobody writes a hex colour. Dark mode only; Archivo for UI and IBM Plex Mono for every path, key, value, status code and code block, self-hosted.

## In scope
- Extraction of the `:root` token set from `design-reference/prototype.html` into the Tailwind theme (colours, radii, type scale, shadows) and global base styles (`color-scheme: dark`, focus ring, selection, scrollbars, `prefers-reduced-motion`).
- Fonts via `@fontsource/archivo` (400/500/600/700) and `@fontsource/ibm-plex-mono` (400/500/600) imported locally.
- The component vocabulary below, built on shadcn/Radix primitives restyled to the tokens, plus a dev-only gallery route `/_dev/ui`.

## Out of scope
The app shell and route tree (FND-13). Feature components. Light mode.

## Contract
Token names (Tailwind keys), values from the prototype: surfaces `bg #0C0F13`, `panel #14181E`, `panel-2 #1A1F27`, `panel-3 #222935`, `slab #0E1217`; ink `ink #E8ECF2`, `ink-2 #99A3B1`, `ink-3 #69737F`; lines `line #242B35`, `line-strong #39424E`, `slab-line #20262F`; action `btn #E8ECF2` on `btn-ink #14171C`; accent `signal #E0B152`, `signal-soft #312513`, `signal-line #6B5422`; status `good #4ADE80`, `warn #E0B152`, `bad #FB7185`, `info #7CA0FF`; methods `m-get #7CA0FF`, `m-post #5DD08A`, `m-put #B79BFF`, `m-patch #56C7D8`, `m-delete #FB7185`; JSON `t-key #9BB4FF`, `t-str #8ED8A8`, `t-num #E8B37A`, `t-bool #C9A2FF`, `t-null #7B8696`, `t-punc #5F6B7C`. Radii 4/6/7/9/11 px; breakpoints 860 and 1240 px (the prototype's); type: UI 14 px/1.5, eyebrow 10.5 px uppercase tracked, mono 12–14 px.
Components (`apps/web/src/components/ui/`): `Button` (primary, ghost, dashed; sm), `IconButton`, `Input`, `Select`, `Textarea`, `Card` + `PanelHead`, `Table`, `MethodBadge`, `StatusCode` (2xx/4xx/5xx tint), `LivePill`, `Segmented`, `DropdownMenu`, `Dialog`, `Toast`, `Slab` (code block), `JsonView` (token-coloured JSON with a provenance underline/fill API), `Eyebrow`, `OptionCard` (radio/checkbox card), `EmptyState`, `Spinner`, `Field` (label + control + error).

## Acceptance criteria
- [ ] No colour literal (`#…`, `rgb(`, `hsl(`) exists under `apps/web/src` outside `src/styles/` (the FND-01 lint rule passes with real code).
- [ ] `<html>` has `color-scheme: dark`; no `dark:` class and no light theme exists.
- [ ] In the gallery, an element with the `mono` utility computes `font-family` starting with `"IBM Plex Mono"`, body text starts with `"Archivo"`, and every network request on page load is same-origin (Playwright asserts no request to any other host, including `fonts.googleapis.com`).
- [ ] Measured contrast: `ink` on `bg` ≥ 7:1; `ink-2` on `panel` ≥ 4.5:1; `bad`, `good`, `warn`, `info` on `panel` ≥ 4.5:1; `ink-3` on `panel` is recorded (it is ≈3.6:1) and flagged in the gallery as *large/decorative only*.
- [ ] The gallery renders every component in every variant and state (default, hover, focus-visible, disabled, error) and every method badge and status class; a reviewer's side-by-side with the prototype for topbar controls, case tabs, table rows and the Slab is approved by the user.
- [ ] Keyboard: every interactive component is reachable by Tab and shows the `signal` focus ring; `DropdownMenu` and `Dialog` trap and restore focus and close on Escape.
- [ ] `JsonView` given a value and a provenance map renders `generated` leaves with the dashed signal underline and `fixed`/`preset` leaves with the soft signal fill (the prototype's `.gen`/`.fix`).

## Tests
Vitest + Testing Library for behaviour (focus, escape, variants); one Playwright test for fonts/requests; a contrast unit test computed from the theme file.

## Open questions
- `ink-3` fails AA for small text and is used by the prototype for eyebrows (10.5 px) and mono hints. Raise it (e.g. toward `#7C8794`) or accept for non-essential text? Needs your call before the freeze.
- Icon set (prototype uses glyph characters): assumed `lucide-react`.
