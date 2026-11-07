import { Toast } from 'radix-ui'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ToastItem = { id: number; message: string }
type ToastApi = { toast: (message: string) => void }

const ToastContext = createContext<ToastApi | null>(null)

let nextId = 1

/** Mount once near the app root. Renders the bottom-centre pill used for "Copied", "Saved" and similar. */
export function ToastProvider({
  children,
  duration = 2200,
}: {
  children: ReactNode
  duration?: number
}) {
  const [items, setItems] = useState<ToastItem[]>([])
  const toast = useCallback((message: string) => {
    setItems((prev) => [...prev, { id: nextId++, message }])
  }, [])
  const api = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={api}>
      <Toast.Provider duration={duration} swipeDirection="down" label="Notifications">
        {children}
        {items.map((item) => (
          <Toast.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) setItems((prev) => prev.filter((t) => t.id !== item.id))
            }}
            className="rounded-lg bg-btn px-3.75 py-2.25 text-control font-medium text-btn-ink shadow-toast"
          >
            <Toast.Description>{item.message}</Toast.Description>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed bottom-[calc(1.125rem+env(safe-area-inset-bottom,0px))] left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2 outline-none" />
      </Toast.Provider>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
