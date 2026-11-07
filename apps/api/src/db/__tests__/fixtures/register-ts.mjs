// Usage: node --no-warnings --experimental-strip-types --import <this file> some-entry.ts
import { register } from 'node:module'

register('./ts-resolve-hooks.mjs', import.meta.url)
