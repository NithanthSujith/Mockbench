// Root ESLint flat config. Custom rules enforce the CLAUDE.md promises (FND-01):
//   1. schema-core / api-contract stay browser-safe (no Node APIs)
//   2. the web app never hardcodes localhost / 127.0.0.1
//   3. the web app has no colour literals outside src/styles
//   4. the web app calls fetch only inside src/lib/api
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const NODE_MODULES = [
  'fs',
  'path',
  'crypto',
  'os',
  'child_process',
  'http',
  'https',
  'http2',
  'net',
  'tls',
  'dns',
  'buffer',
  'process',
  'stream',
  'zlib',
  'url',
  'util',
  'events',
  'worker_threads',
  'readline',
  'vm',
  'module',
  'assert',
  'cluster',
  'dgram',
  'perf_hooks',
  'querystring',
  'string_decoder',
]
const PURE_MSG =
  'This package must stay browser-safe: no Node APIs (CLAUDE.md "schema-core purity"). Use web-standard APIs or the package helpers.'

const pureFiles = [
  'packages/schema-core/**/*.{ts,tsx,js,mjs}',
  'packages/api-contract/src/**/*.{ts,tsx,js,mjs}',
]

const LOCALHOST_MSG =
  'Never hardcode localhost/127.0.0.1 in the web app; use relative URLs or lib/mock-url.ts.'
const COLOUR_MSG = 'No colour literals outside src/styles: reference a theme token instead.'
const COLOUR_RE = '/#[0-9a-fA-F]{3,8}\\b|\\brgba?\\(|\\bhsla?\\(/'

const localhostSelectors = [
  { selector: 'Literal[value=/localhost|127\\.0\\.0\\.1/]', message: LOCALHOST_MSG },
  { selector: 'TemplateElement[value.raw=/localhost|127\\.0\\.0\\.1/]', message: LOCALHOST_MSG },
]
const colourSelectors = [
  { selector: `Literal[value=${COLOUR_RE}]`, message: COLOUR_MSG },
  { selector: `TemplateElement[value.raw=${COLOUR_RE}]`, message: COLOUR_MSG },
]

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'docs/**',
      'design-reference/**',
      '**/routeTree.gen.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.es2022 } },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },

  // Rule 1 — purity of schema-core and api-contract
  {
    files: pureFiles,
    languageOptions: { globals: { ...globals.browser, ...globals.es2022 } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: PURE_MSG },
            { group: NODE_MODULES.flatMap((m) => [m, `${m}/*`]), message: PURE_MSG },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['Buffer', 'process', 'require', '__dirname', '__filename'].map((name) => ({
          name,
          message: PURE_MSG,
        })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='crypto'][property.name=/^(subtle|randomUUID)$/]",
          message:
            'crypto.subtle / crypto.randomUUID are unavailable on http://<LAN-IP> (insecure context). Use the package sha1/uuid helpers.',
        },
      ],
    },
  },

  // Rules 2-4 — the web app
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.es2022 } },
    rules: {
      'no-restricted-syntax': ['error', ...localhostSelectors, ...colourSelectors],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Call the API through apps/web/src/lib/api only.' },
      ],
    },
  },
  {
    files: ['apps/web/src/styles/**'],
    rules: { 'no-restricted-syntax': ['error', ...localhostSelectors] },
  },
  {
    files: ['apps/web/src/lib/api/**'],
    rules: { 'no-restricted-globals': 'off' },
  },
)
