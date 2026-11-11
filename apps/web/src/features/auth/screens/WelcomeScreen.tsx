import { NoWorkspaceState } from '../NoWorkspaceState'

/** /welcome: where a signed-in user with no workspace lands. */
export function WelcomeScreen() {
  return (
    <div
      data-screen="auth/WelcomeScreen"
      className="mx-auto grid min-h-[60vh] place-items-center px-4"
    >
      <NoWorkspaceState />
    </div>
  )
}
