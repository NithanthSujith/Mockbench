import { useParams } from '@tanstack/react-router'
import { Button } from '../../components/ui'

// STUB (FND-13) for the topbar Publish slot: replaced by RUN-09 (which opens the publish dialog).
// Keep the export name.
export function PublishButton() {
  const { projectSlug } = useParams({ strict: false })
  if (!projectSlug) return null
  return (
    <Button disabled data-slot="publish">
      Publish
    </Button>
  )
}
