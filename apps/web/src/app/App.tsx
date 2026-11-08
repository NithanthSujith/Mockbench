import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { ToastProvider } from '../components/ui'
import type { createAppRouter } from './router'

export function App({
  queryClient,
  router,
}: {
  queryClient: QueryClient
  router: ReturnType<typeof createAppRouter>
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
