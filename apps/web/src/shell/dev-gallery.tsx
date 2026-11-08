import { lazy, Suspense } from 'react'

// import.meta.env.DEV is a compile-time constant, so in production the whole dynamic import is dead
// code and the gallery never reaches the bundle.
const Gallery = import.meta.env.DEV
  ? lazy(() => import('../components/ui/gallery').then((m) => ({ default: m.Gallery })))
  : () => null

export function DevGallery() {
  return (
    <Suspense fallback={null}>
      <Gallery />
    </Suspense>
  )
}
