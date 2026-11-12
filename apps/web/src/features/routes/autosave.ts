import { useCallback, useEffect, useRef, useState } from 'react'

export const AUTOSAVE_DELAY_MS = 600

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** Tracks in-flight saves for the "Saving... / Saved" indicator. */
export function useSaveTracker() {
  const [state, setState] = useState<SaveState>('idle')
  const pending = useRef(0)
  const failed = useRef(false)
  const track = useCallback(async (promise: Promise<unknown>) => {
    pending.current += 1
    failed.current = false
    setState('saving')
    try {
      await promise
    } catch (error) {
      failed.current = true
      throw error
    } finally {
      pending.current -= 1
      if (pending.current === 0) setState(failed.current ? 'error' : 'saved')
    }
  }, [])
  return { state, track }
}

/**
 * Collects field patches and sends them as one request after `delay` ms without a new change.
 * Pending changes are sent when the component unmounts. `drop` removes a field (it became invalid).
 */
export function useDebouncedSaver<P extends Record<string, unknown>>(
  save: (patch: Partial<P>) => Promise<unknown>,
  { delay = AUTOSAVE_DELAY_MS, enabled = true }: { delay?: number; enabled?: boolean } = {},
) {
  const saveRef = useRef(save)
  saveRef.current = save
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const patch = useRef<Partial<P>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const body = patch.current
    patch.current = {}
    if (!enabledRef.current || Object.keys(body).length === 0) return Promise.resolve()
    return saveRef.current(body).then(
      () => undefined,
      () => undefined,
    )
  }, [])

  const schedule = useCallback(
    (change: Partial<P>) => {
      if (!enabledRef.current) return
      patch.current = { ...patch.current, ...change }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [delay, flush],
  )

  const drop = useCallback((key: keyof P) => {
    const next = { ...patch.current }
    delete next[key]
    patch.current = next
  }, [])

  useEffect(() => () => void flush(), [flush])

  return { schedule, drop, flush }
}
