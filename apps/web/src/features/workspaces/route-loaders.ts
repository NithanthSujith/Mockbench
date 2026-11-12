import type { RouteLoader } from '../../lib/route-loader'
import { prefetchMembers } from './members-queries'

// STUB (FND-13): the workspace layout has nothing to prefetch.
export const workspaceLoader: RouteLoader = () => {}
export const membersLoader: RouteLoader = (args) => prefetchMembers(args)
