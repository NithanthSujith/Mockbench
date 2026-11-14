import { useState } from 'react'
import { Button } from '../../components/ui'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'
import { exportFileName, exportText } from './project-file'

/** Client-side download: a data URL works on a LAN IP over HTTP, where blob/clipboard APIs may not. */
function download(name: string, text: string): void {
  const a = document.createElement('a')
  a.href = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Downloads the project's draft and presets as `<slug>.mockbench.json`. */
export function ExportProjectButton({ projectId, slug }: { projectId: string; slug: string }) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setFailure(null)
    try {
      const doc = await api.projects.export({ params: { projectId } })
      download(exportFileName(slug), exportText(doc))
    } catch (error) {
      setFailure(isApiError(error) ? error.message : 'Could not export the project.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {failure ? (
        <span role="alert" className="text-small text-bad">
          {failure}
        </span>
      ) : null}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run()}>
        Export
      </Button>
    </>
  )
}
