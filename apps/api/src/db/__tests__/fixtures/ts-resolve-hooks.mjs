// Test-only ESM resolve hook: lets Node's built-in type stripping run our extensionless relative
// imports (`./client`) by retrying them with `.ts`. Keeps child-process tests free of a TS runner.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.')) {
      try {
        return await nextResolve(`${specifier}.ts`, context)
      } catch {
        // fall through to the original error
      }
    }
    throw error
  }
}
