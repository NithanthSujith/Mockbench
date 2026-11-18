---
'@mockbench/api': patch
---

`pnpm dev` now starts the API. The dev entry imported the server module, which only started itself when it was the entry file.
