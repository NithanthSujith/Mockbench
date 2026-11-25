---
'@mockbench/api': patch
'@mockbench/schema-core': patch
---

The request log now stores a query parameter or header named `__proto__` like any other key; it used to be dropped. Email detection during schema inference runs in linear time on any input, and no longer treats a domain with an empty label (`a@b..co`) as an email.
