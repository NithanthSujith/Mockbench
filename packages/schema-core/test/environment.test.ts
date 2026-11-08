import { describe, expect, it } from 'vitest'

// The suite runs once per project (see vitest.config.ts). This proves each run really happened in the
// environment it claims, so "the goldens pass under happy-dom" cannot silently mean "under node twice".
describe('test environment', () => {
  it('runs under the configured project: node has no window, browser-env is happy-dom', ({
    task,
  }) => {
    const project = task.file.projectName
    const hasWindow = typeof window !== 'undefined' && typeof document !== 'undefined'
    if (project === 'node') {
      expect(hasWindow).toBe(false)
    } else {
      expect(project).toBe('browser-env')
      expect(hasWindow).toBe(true)
      expect(navigator.userAgent).toContain('HappyDOM')
    }
  })
})
