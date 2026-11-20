---
'@mockbench/api': minor
---

Publishing a version whose baked responses total more than 64 MiB now fails with `422 baked_too_large`, listing the 10 largest cases; the Publish dialog shows them with their sizes (RUN-14).
