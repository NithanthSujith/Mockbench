import type { ResponseCase, Route } from '@mockbench/api-contract'
import { Copy } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  Button,
  Card,
  IconButton,
  PanelBody,
  PanelHead,
  StatusCode,
  useToast,
} from '../../components/ui'
import { sendMockRequest, type MockResponse } from '../../lib/api/mock-request'
import { copyText } from '../../lib/copy'
import { usePreviewProject } from './queries'
import { buildCurl, caseHeader, mockRequestPath } from './try-it-snippet'

type Sent =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'failed'; message: string }
  | ({ kind: 'done'; mockError: { error: string; hint: string | null } | null } & MockResponse)

const NO_VERSION = 'Publish and deploy this project before the URL answers'

function parseMockError(body: string): { error: string; hint: string | null } {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; hint?: unknown }
    return {
      error: typeof parsed.error === 'string' ? parsed.error : 'mock_error',
      hint: typeof parsed.hint === 'string' ? parsed.hint : null,
    }
  } catch {
    return { error: 'mock_error', hint: null }
  }
}

/** The curl for the selected route and case, a Copy that works over plain HTTP, and a live Send. */
export function TryItPanel({ case: caseItem, route }: { case: ResponseCase; route: Route }) {
  const project = usePreviewProject(route.projectId)
  const { toast } = useToast()
  const snippetRef = useRef<HTMLPreElement>(null)
  const [sent, setSent] = useState<Sent>({ kind: 'idle' })

  const slug = project.data?.slug
  const live = Boolean(project.data?.activeVersion)
  const curl = slug ? buildCurl(slug, route, caseItem) : ''

  async function copy() {
    const outcome = await copyText(curl, snippetRef.current)
    toast(outcome === 'copied' ? 'Copied' : 'Selected — press Ctrl/Cmd+C')
  }

  async function send() {
    if (!slug) return
    const header = caseHeader(caseItem)
    setSent({ kind: 'sending' })
    try {
      const res = await sendMockRequest(
        mockRequestPath(slug, route),
        route.method,
        header === null ? {} : { 'X-Mock-Case': header },
      )
      const mockError = res.isMockError ? parseMockError(res.body) : null
      setSent({ kind: 'done', ...res, mockError })
    } catch (e) {
      setSent({ kind: 'failed', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <Card data-screen="preview/TryItPanel" data-case-id={caseItem.id}>
      <PanelHead>
        <h3>Try it</h3>
        <span className="ml-auto text-small text-ink-3">
          Calls the deployed version, not your draft
        </span>
      </PanelHead>
      <PanelBody className="flex flex-col gap-3">
        <div className="relative">
          <pre
            ref={snippetRef}
            aria-label="curl command"
            className="mono m-0 overflow-x-auto rounded-md border border-line bg-panel-2 py-2.5 pl-3 pr-10 text-small text-ink-2 select-text"
          >
            {curl}
          </pre>
          <IconButton
            aria-label="Copy curl command"
            className="absolute right-1.5 top-1.5 size-6"
            disabled={!slug}
            onClick={copy}
          >
            <Copy aria-hidden className="size-3.5" />
          </IconButton>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!live || sent.kind === 'sending'} onClick={send}>
            {sent.kind === 'sending' ? 'Sending…' : 'Send'}
          </Button>
          {project.data && !live ? (
            <span className="text-small text-warn">{NO_VERSION}</span>
          ) : null}
        </div>
        <div aria-live="polite" className="flex flex-col gap-2">
          {sent.kind === 'failed' ? (
            <p role="alert" className="m-0 text-control text-bad">
              Request failed: {sent.message}
            </p>
          ) : null}
          {sent.kind === 'done' ? (
            <>
              <div className="flex flex-wrap items-center gap-2.5">
                <StatusCode code={sent.status} />
                <span className="mono text-small text-ink-2">{sent.ms} ms</span>
                {sent.mockError ? (
                  <span className="rounded-full bg-bad/14 px-2 py-0.5 text-tiny font-semibold text-bad">
                    Mock server error
                  </span>
                ) : null}
              </div>
              {sent.mockError ? (
                <p className="m-0 text-control text-ink-2">
                  <span className="mono text-bad">{sent.mockError.error}</span>
                  {sent.mockError.hint ? ` — ${sent.mockError.hint}` : null}
                </p>
              ) : null}
              <dl
                aria-label="Response headers"
                className="mono m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-small"
              >
                {sent.mockHeaders.map(([name, value]) => (
                  <div key={name} className="contents">
                    <dt className="text-ink-3">{name}</dt>
                    <dd className="m-0 break-all text-ink-2">{value}</dd>
                  </div>
                ))}
              </dl>
              {sent.body ? (
                <pre
                  aria-label="Response body"
                  className="mono m-0 max-h-[40vh] overflow-auto rounded-md border border-line bg-panel-2 p-2.5 text-small text-ink-2 select-text"
                >
                  {sent.body}
                </pre>
              ) : (
                <p className="m-0 text-small text-ink-3">— no response body —</p>
              )}
            </>
          ) : null}
        </div>
      </PanelBody>
      <div className="border-t border-line px-3.5 py-2.25 text-tiny text-ink-3">
        {project.data ? (live ? 'Any machine on the LAN can call this now.' : NO_VERSION) : null}
      </div>
    </Card>
  )
}
