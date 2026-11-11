import { useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../components/ui'
import { useCurrentWorkspace } from '../projects/queries'
import { PublishDialog } from './PublishDialog'
import { useProjectForVersions } from './queries'

/** Topbar slot: opens the publish dialog. Hidden for viewers and outside a project. */
export function PublishButton() {
  const { projectSlug } = useParams({ strict: false })
  const project = useProjectForVersions(projectSlug).data
  const { canCreate } = useCurrentWorkspace()
  const [open, setOpen] = useState(false)
  if (!projectSlug || !project || !canCreate) return null
  return (
    <>
      <Button data-slot="publish" onClick={() => setOpen(true)}>
        Publish
      </Button>
      <PublishDialog
        open={open}
        onOpenChange={setOpen}
        projectId={project.id}
        projectSlug={projectSlug}
      />
    </>
  )
}
