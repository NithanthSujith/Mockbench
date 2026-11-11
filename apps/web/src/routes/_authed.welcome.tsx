// Route file: wiring only. The screen lives in features/auth/screens.
import { createFileRoute } from '@tanstack/react-router'
import { WelcomeScreen } from '../features/auth/screens/WelcomeScreen'

export const Route = createFileRoute('/_authed/welcome')({
  component: WelcomeScreen,
})
