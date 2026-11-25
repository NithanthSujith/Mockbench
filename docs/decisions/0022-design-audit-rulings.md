# 0022 — Design audit rulings: contrast, link style, loading, layout
Status: accepted      Date: 2026-11-25

## Context
On 2026-11-25 a design audit captured every screen at 1440, 1000 and 390 px and measured it against the prototype, DESIGN.md and WCAG 2.2 AA. It fixed 16 clear defects and raised 12 proposals that change the design on purpose, plus two more layout issues. The owner reviewed the running build and asked for all of them to be fixed, together with a misaligned schema builder they spotted themselves. Several of these go beyond what the prototype, DESIGN.md or the specs say, so they are recorded here.

## Decision
1. **Builder columns align at every depth.** Every builder row has the same grid tracks. The indent lives inside the first cell, and the actions column is a fixed 102 px. The prototype's `.brow` indented the whole row and ended in an `auto` column, so the type select drifted with depth and with the number of action buttons (six x positions, spread over 66 px).
2. **New token `line-input #5F6A78`** for the borders of text fields, selects and dropdown triggers. It is 3.24:1 on `panel` and 3.01:1 on `panel-2` (WCAG 1.4.11; `line-strong` was 1.75:1 and 1.63:1). Builder key fields stay borderless at rest, because they are inline-edit fields. Their hover and focus borders use the new token.
3. **`t-punc` raised from `#5F6B7C` to `#75818F`**: 4.74:1 on the code slab, up from 3.47:1. `#7B8696` was avoided because it is `t-null`.
4. **Highlighted menu and select rows** use `panel-3` instead of `panel-2`. The highlight is the keyboard focus, and `panel-2` on `panel` was about 1.1:1. A 2 px focus-blue bar on the left edge was tried; the owner rejected it, so the background change is the only cue.
5. **Loading.** A route whose loader is still running after 300 ms shows a spinner where the screen will be, for at least 300 ms (`defaultPendingComponent`). Before, a slow load showed a blank page.
6. **Not found.** An unknown or forbidden project renders under the top bar, like every other not-found.
7. **One in-text link style** (`textLink`): `info` blue, underlined at rest with a soft underline that turns solid on hover. Blue on the grey body text is not a 3:1 difference, so the underline is what marks a link (WCAG 1.4.1). Amber stays reserved for pinned, default and selected.
8. **Builder targets.** The drag handle and expand arrow are 24 px targets with no gap between them (WCAG 2.5.8), drawn at the prototype's 16 px.
9. **One workspace.** The switcher stays a plain label (WS-03), but it is styled as text, not as a bordered control.
10. **Top bar.** At widths above 860 px the mock base URL takes the free space and truncates instead of wrapping the account menu onto a second line.
11. **Mono for values.** Version timestamps, route and case counts, and deployment times are set in IBM Plex Mono.
12. **Tables run to the card edges** on Presets too. In the preset editor, the Result cell wraps, so the Delete column stays inside the dialog.
13. **Stable scrollbar gutter.** `html` has `scrollbar-gutter: stable`, so the layout keeps the same width whether or not a page scrolls; it used to shift 10 px sideways between a short page and a long one. Radix's scroll lock adds a right margin the width of the scrollbar while a dialog or menu is open, which on top of the gutter would shift the page 10 px the other way, so that margin is set to 0.
14. **Copy.**
    - Welcome: "Create one, or ask a workspace owner to add your email."
    - Request log, deployed project: title "No requests yet", with the description "Calls to this project's mock URL show up here as they arrive." Not deployed: "The log starts filling once this project is deployed." plus the Versions link.
    - Register checks name, email and password together on submit, using the registry's `NameField` and `EmailField`.

## Consequences
- FND-12's token list gains `line-input` and changes `t-punc`. AUTH-03 and RUN-08 have their wording amended. The theme test enforces the new contrast floors.
- `design-reference/prototype.html` is not edited. It remains the visual reference, and these rulings take precedence where they differ.

## Revisit if
A light theme is ever added (every value here is dark-only), or the owner wants the builder key fields to show a border at rest.
