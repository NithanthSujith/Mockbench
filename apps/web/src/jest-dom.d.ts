// Type-only: adds the jest-dom matchers (toHaveTextContent, toHaveAttribute, ...) to the copy of
// vitest that THIS package's tests import. pnpm keeps several copies of vitest when packages differ
// in optional peers (jsdom here, happy-dom in schema-core), and jest-dom's own augmentation can land
// on a different copy than the one resolved from apps/web.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends TestingLibraryMatchers<unknown, T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
