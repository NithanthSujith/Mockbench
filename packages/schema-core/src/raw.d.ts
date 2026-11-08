declare module '*?raw' {
  const content: string
  export default content
}

// The slice of Vite's ImportMeta that the tests use (this package does not depend on vite/client types).
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options?: { eager?: boolean; import?: string; query?: string },
  ): Record<string, T>
  readonly env: Record<string, string | undefined>
}
