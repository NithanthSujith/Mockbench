export interface GuardEntry {
  generatorVersion: number
  goldensHash: string
}

/**
 * The generator change guard. `generator-guard.json` holds an append-only history of
 * `{ generatorVersion, goldensHash }` pairs. The last entry must equal the current pair, so:
 *
 * - goldens changed, GENERATOR_VERSION not bumped  -> fails (the output of an existing rule changed
 *   without telling anyone: published payloads and previews would silently disagree);
 * - GENERATOR_VERSION bumped, goldens unchanged    -> fails (a bump must come with a visible output change);
 * - both changed                                   -> fails until the new pair is appended to the file,
 *   which is the deliberate, reviewable act.
 *
 * Returns the list of problems (empty when the guard is satisfied).
 */
export function evaluateGuard(
  history: readonly GuardEntry[],
  version: number,
  hash: string,
): string[] {
  const problems: string[] = []
  const last = history[history.length - 1]
  if (!last) return ['generator-guard.json has no history']

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]
    const cur = history[i]
    if (prev && cur && cur.generatorVersion <= prev.generatorVersion) {
      problems.push(
        `history is not strictly increasing: version ${cur.generatorVersion} follows ${prev.generatorVersion}`,
      )
    }
  }
  const seen = new Map<string, number>()
  for (const e of history) {
    const earlier = seen.get(e.goldensHash)
    if (earlier !== undefined) {
      problems.push(
        `GENERATOR_VERSION ${e.generatorVersion} was recorded with the same goldens as version ${earlier}: a version bump must change at least one golden`,
      )
    }
    seen.set(e.goldensHash, e.generatorVersion)
  }

  const sameHash = last.goldensHash === hash
  const sameVersion = last.generatorVersion === version
  if (sameHash && sameVersion) return problems
  if (!sameHash && sameVersion) {
    problems.push(
      `the goldens changed but GENERATOR_VERSION is still ${version}. If the generator's documented output really changed, bump GENERATOR_VERSION in src/generate.ts, then append ` +
        `{ "generatorVersion": ${version + 1}, "goldensHash": "${hash}" } to test/generator-guard.json. If it did not, the change is a bug: revert it.`,
    )
  } else if (sameHash && !sameVersion) {
    problems.push(
      `GENERATOR_VERSION is ${version} but no golden changed since version ${last.generatorVersion}. Revert the bump, or change the output deliberately and update the goldens.`,
    )
  } else {
    problems.push(
      `goldens and GENERATOR_VERSION both changed: append { "generatorVersion": ${version}, "goldensHash": "${hash}" } to test/generator-guard.json to record it.`,
    )
  }
  return problems
}
