import { Outlet } from '@tanstack/react-router'
import { Topbar } from './topbar'

/** Everything behind the session guard: the top bar, then the matched screen. */
export function AuthedLayout() {
  return (
    <>
      <Topbar />
      <Outlet />
    </>
  )
}
