import type { ResponseCase, Route } from '@mockbench/api-contract'
import { useEffect, useMemo, useState } from 'react'
import { Card, JsonView, PanelBody, PanelHead, Spinner, StatusCode } from '../../components/ui'
import { computePreview, type PreviewInput, type PreviewResult } from './compute'
import { usePreviewPresets, usePreviewProject } from './queries'

/** Generation runs this long after the last change, so typing never regenerates per keystroke. */
export const PREVIEW_DEBOUNCE_MS = 150

const MODE_LABEL = {
  deterministic: 'Deterministic',
  seeded: 'Seeded',
  random: 'Random',
} as const

type Pending = { key: string; input: PreviewInput }

/**
 * Debounces the generation inputs. A different case shows at once; edits within the same case wait
 * for the debounce window.
 */
function useDebouncedInput(key: string, input: PreviewInput | null): PreviewInput | null {
  const [settled, setSettled] = useState<Pending | null>(input ? { key, input } : null)
  useEffect(() => {
    if (!input || settled?.input === input) return
    if (!settled || settled.key !== key) {
      setSettled({ key, input })
      return
    }
    const timer = setTimeout(() => setSettled({ key, input }), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key, input, settled])
  if (!input) return null
  return settled && settled.key === key ? settled.input : input
}

export function ResponsePreview({ case: caseItem, route }: { case: ResponseCase; route: Route }) {
  const projectId = route.projectId
  const project = usePreviewProject(projectId)
  const presets = usePreviewPresets(projectId)

  const input = useMemo<PreviewInput | null>(() => {
    if (!project.data || !presets.data) return null
    return {
      schema: caseItem.schema,
      projectId,
      settings: {
        indexing: project.data.settings.indexing,
        mode: project.data.settings.mode,
      },
      components: project.data.components,
      presets: presets.data.items.filter((p) => p.isEnabled),
    }
  }, [caseItem.schema, projectId, project.data, presets.data])

  const effective = useDebouncedInput(caseItem.id, input)
  const noBody = caseItem.statusCode === 204
  const result = useMemo<PreviewResult | null>(
    () => (effective && !noBody ? computePreview(effective) : null),
    [effective, noBody],
  )

  const mode = project.data?.settings.mode
  const delay = caseItem.delayMs ?? project.data?.settings.defaultDelayMs ?? 0
  const version = project.data?.activeVersion?.label ?? 'not published yet'

  return (
    <Card data-screen="preview/ResponsePreview" data-case-id={caseItem.id}>
      <PanelHead>
        <h3>Response</h3>
        <StatusCode code={caseItem.statusCode} />
        <span className="text-control text-ink-2">{caseItem.name}</span>
        {mode ? (
          <span className="ml-auto flex flex-wrap items-center gap-2 text-small text-ink-3">
            <span className="mono text-ink-2" data-testid="preview-mode">
              {MODE_LABEL[mode]}
            </span>
            {mode === 'random' ? (
              <span className="rounded-full bg-warn/14 px-2 py-0.5 text-tiny font-semibold text-warn">
                Fresh on every request — not baked
              </span>
            ) : mode === 'seeded' ? (
              <span>Values are drawn from stable pools seeded by the key and position.</span>
            ) : (
              <span>
                Values come from the key and position, so <code className="mono">role</code> becomes{' '}
                <code className="mono">role-1</code> — change this in project settings.
              </span>
            )}
          </span>
        ) : null}
      </PanelHead>
      <PanelBody className="flex flex-col gap-3">
        {project.isError || presets.isError ? (
          <p role="alert" className="m-0 text-control text-bad">
            Could not load the project settings needed for the preview. Reload the page to try
            again.
          </p>
        ) : noBody ? (
          <p className="m-0 text-control text-ink-2">— 204 sends no response body —</p>
        ) : !result ? (
          <div className="grid place-items-center py-6">
            <Spinner label="Loading preview" />
          </div>
        ) : result.kind === 'ok' ? (
          <JsonView
            json={result.json}
            provenance={result.provenance}
            aria-label="Response preview"
            className="max-h-[60vh] select-text"
          />
        ) : result.kind === 'too-large' ? (
          <p role="alert" className="m-0 text-control text-warn">
            Too large to preview: would generate more than {result.limit.toLocaleString('en-US')}{' '}
            values (limit {result.limit.toLocaleString('en-US')})
          </p>
        ) : (
          <div role="alert" className="text-control">
            <p className="m-0 mb-1.5 text-bad">
              This schema is not valid, so nothing can be shown.
            </p>
            <ul className="m-0 list-none space-y-1 p-0 text-small text-ink-2">
              {result.issues.map((issue, i) => (
                <li key={i}>
                  <span className="mono text-ink-3">{issue.path.join('.') || 'root'}</span>{' '}
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl
          aria-label="Diagnostic headers"
          className="mono m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-small"
        >
          <dt className="text-ink-3">X-Mock-Version</dt>
          <dd className="m-0 text-ink-2">{version}</dd>
          <dt className="text-ink-3">X-Mock-Route</dt>
          <dd className="m-0 text-ink-2">
            {route.method} {route.path}
          </dd>
          <dt className="text-ink-3">X-Mock-Case</dt>
          <dd className="m-0 text-ink-2">{caseItem.name}</dd>
          <dt className="text-ink-3">Delay</dt>
          <dd className="m-0 text-ink-2">{delay} ms</dd>
        </dl>
      </PanelBody>
      <div className="flex flex-wrap gap-3.5 border-t border-line px-3.5 py-2.25 text-tiny text-ink-3">
        <span>
          <span className="mono border-b border-dashed border-signal-line text-ink-2">name-1</span>{' '}
          generated from the key
        </span>
        <span>
          <span className="mono rounded-[3px] bg-signal/14 px-0.5 text-signal">INR</span> pinned or
          from a preset
        </span>
      </div>
    </Card>
  )
}
