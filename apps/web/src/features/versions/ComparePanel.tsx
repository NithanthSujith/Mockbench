import type { VersionSummary } from '@mockbench/api-contract'
import { useState } from 'react'
import { Card, PanelBody, PanelHead, Select, SelectItem, Spinner } from '../../components/ui'
import { DiffView } from './DiffView'
import { useVersionDiff } from './queries'

/** RUN-10: from/to pickers and the diff between the two chosen versions (newest versions first). */
export function ComparePanel({
  projectId,
  versions,
}: {
  projectId: string
  versions: VersionSummary[]
}) {
  // `versions` is newest first: default to the previous version against the newest.
  const [from, setFrom] = useState(versions[1]?.id ?? versions[0]?.id)
  const [to, setTo] = useState(versions[0]?.id)
  const diff = useVersionDiff(projectId, from, to)

  const picker = (label: string, value: string | undefined, set: (id: string) => void) => (
    <div className="flex items-center gap-2 text-small text-ink-2">
      {label}
      <Select mono value={value} onValueChange={set} aria-label={label}>
        {versions.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {v.label}
          </SelectItem>
        ))}
      </Select>
    </div>
  )

  return (
    <Card>
      <PanelHead>
        <h3 className="m-0">Compare versions</h3>
      </PanelHead>
      <PanelBody>
        <div className="mb-3 flex flex-wrap gap-4">
          {picker('From', from, setFrom)}
          {picker('To', to, setTo)}
        </div>
        {diff.isPending ? (
          <Spinner />
        ) : diff.isError ? (
          <p role="alert" className="m-0 text-small text-bad">
            Could not compare these versions.
          </p>
        ) : (
          <DiffView diff={diff.data} />
        )}
      </PanelBody>
    </Card>
  )
}
