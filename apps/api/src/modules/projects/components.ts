// Project-level components (API-CONTRACT 3.4): the named MockSchema nodes that `ref` nodes point at.
// Replacing them is validated twice: every component must itself be a valid schema (against the whole
// new set), and no stored case may be left pointing at a component that no longer exists.
import type { ValidationIssue } from '@mockbench/api-contract'
import { validateSchema } from '@mockbench/schema-core'
import type { MockNode } from '@mockbench/schema-core'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { responseCases, routes } from '../../db/schema'
import { HttpError } from '../../http/errors'

type Components = Record<string, MockNode>

/** The components themselves: each one validated as the root of a schema that sees the whole set. */
function componentIssues(components: Components): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  for (const [name, node] of Object.entries(components)) {
    const result = validateSchema({ version: 1, components: {}, root: node }, { components })
    if (result.ok) continue
    for (const issue of result.issues) {
      // The validator reports paths from the envelope root; this node is the component itself.
      const rest = issue.path[0] === 'root' ? issue.path.slice(1) : issue.path
      const mapped: ValidationIssue = {
        path: ['components', name, ...rest],
        code: issue.code,
        message: issue.message,
      }
      const key = JSON.stringify(mapped)
      if (!seen.has(key)) {
        seen.add(key)
        issues.push(mapped)
      }
    }
  }
  return issues
}

/** Stored cases whose schema would no longer resolve one of its `ref`s with the new component set. */
async function inUseIssues(
  db: Db,
  projectId: string,
  components: Components,
): Promise<ValidationIssue[]> {
  const cases = await db
    .select({
      schema: responseCases.schema,
      caseName: responseCases.name,
      method: routes.method,
      path: routes.path,
    })
    .from(responseCases)
    .innerJoin(routes, eq(routes.id, responseCases.routeId))
    .where(eq(routes.projectId, projectId))

  const issues: ValidationIssue[] = []
  const reported = new Set<string>()
  for (const c of cases) {
    const result = validateSchema(c.schema, { components })
    if (result.ok) continue
    for (const issue of result.issues) {
      if (issue.code !== 'unknown_ref') continue
      // The validator names the missing component in its message; fall back to the node path.
      const name = /"([^"]+)"/.exec(issue.message)?.[1] ?? issue.path.join('.')
      const key = `${name}|${c.method} ${c.path}|${c.caseName}`
      if (reported.has(key)) continue
      reported.add(key)
      issues.push({
        path: ['components', name],
        code: 'component_in_use',
        message: `Component "${name}" is still used by ${c.method} ${c.path} (case "${c.caseName}"). Remove the references first.`,
      })
    }
  }
  return issues
}

/** Throws `422 validation_failed` when the proposed component set is invalid or would orphan a `ref`. */
export async function assertComponentsAcceptable(
  db: Db,
  projectId: string,
  components: Components,
): Promise<void> {
  const own = componentIssues(components)
  if (own.length > 0) {
    throw new HttpError(422, 'validation_failed', 'Some components are not valid.', own)
  }
  const inUse = await inUseIssues(db, projectId, components)
  if (inUse.length > 0) {
    throw new HttpError(
      422,
      'validation_failed',
      'A component that stored cases still use cannot be removed or renamed.',
      inUse,
    )
  }
}
