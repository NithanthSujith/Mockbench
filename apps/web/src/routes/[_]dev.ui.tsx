// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute, notFound } from '@tanstack/react-router'
import { DevGallery } from '../shell/dev-gallery'

// Development only: the UI-kit gallery from FND-12. In a production build the route 404s and the
// gallery code is not in the bundle (import.meta.env.DEV is replaced by false at build time).
export const Route = createFileRoute('/_dev/ui')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: DevGallery,
})
