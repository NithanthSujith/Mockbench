import { useParams } from '@tanstack/react-router'
import { Copy } from 'lucide-react'
import { useRef } from 'react'
import { IconButton, useToast } from '../components/ui'
import { AccountMenu } from '../features/auth/AccountMenu'
import { ProjectSwitcher } from '../features/projects/ProjectSwitcher'
import { LivePill } from '../features/versions/LivePill'
import { PublishButton } from '../features/versions/PublishButton'
import { WorkspaceSwitcher } from '../features/workspaces/WorkspaceSwitcher'
import { copyText } from '../lib/copy'
import { getMockBaseUrl, getMockHost } from '../lib/mock-url'
import { Brand } from './brand'

/** Mock base URL of the open project, or just the server address outside a project. */
function BaseUrl() {
  const { projectSlug } = useParams({ strict: false })
  const { toast } = useToast()
  const textRef = useRef<HTMLSpanElement>(null)
  const value = projectSlug ? getMockBaseUrl(projectSlug) : getMockHost()
  return (
    <div
      data-slot="base-url"
      className="mono flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-panel-2 px-2 py-1.25 text-small text-ink-2 max-narrow:order-last max-narrow:w-full"
    >
      <span ref={textRef} className="truncate" title={value}>
        {value}
      </span>
      <IconButton
        aria-label="Copy base URL"
        className="size-5.5 border-0"
        onClick={async () => {
          const outcome = await copyText(value, textRef.current)
          toast(outcome === 'copied' ? 'Copied' : 'Selected: press Ctrl/Cmd+C')
        }}
      >
        <Copy aria-hidden className="size-3.5" />
      </IconButton>
    </div>
  )
}

/**
 * The sticky top bar (prototype .topbar): brand, workspace and project switchers, LIVE pill, the
 * address the mock is reachable at, Publish, account. Each slot is a component owned by a feature team.
 */
export function Topbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-panel">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-2.5 px-4 py-2.5">
        <Brand />
        <WorkspaceSwitcher />
        <span aria-hidden className="text-ink-3">
          /
        </span>
        <ProjectSwitcher />
        <LivePill />
        <span className="min-w-0 flex-1" />
        <BaseUrl />
        <PublishButton />
        <AccountMenu />
      </div>
    </header>
  )
}
