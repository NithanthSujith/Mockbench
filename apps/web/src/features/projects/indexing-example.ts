import { generate, type MockNode, type MockSchema } from '@mockbench/schema-core'
import type { ProjectSettings } from '@mockbench/api-contract'

const tags: MockNode = { type: 'array', count: 2, items: { type: 'string' } }
const users: MockNode = {
  type: 'array',
  count: 2,
  items: { type: 'object', fields: [{ key: 'tags', node: tags }] },
}
const SAMPLE: MockSchema = {
  version: 1,
  components: {},
  root: { type: 'object', fields: [{ key: 'users', node: users }] },
}

/** `users[2].tags` as the generator emits it for the given indexing, computed locally. */
export function indexingExample(indexing: ProjectSettings['indexing']): string[] {
  const { json } = generate(SAMPLE, {
    projectId: 'indexing-example',
    settings: { indexing, mode: 'deterministic' },
  })
  const body = JSON.parse(json) as { users: { tags: string[] }[] }
  return body.users[1]?.tags ?? []
}
