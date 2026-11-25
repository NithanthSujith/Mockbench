---
'@mockbench/web': patch
---

A design pass over every screen, with the rulings in ADR 0022:

- The schema builder's columns line up at every depth.
- Tables no longer widen the page on phones, and tall dialogs scroll.
- Selects match input height.
- Field borders and highlighted menu rows reach WCAG contrast.
- Slow loads show a spinner, and failed loads show an error instead of an empty state.
- One underlined link style.
- The top bar stays on one line at 1000 px.
- Register flags every empty field at once.
