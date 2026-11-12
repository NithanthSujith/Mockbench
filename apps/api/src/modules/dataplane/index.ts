// The data plane is a router, not a set of control-plane handlers: see ./router.ts.
export { createDataPlaneRouter } from './router'
export type { DataPlaneDeps } from './router'
export {
  VersionCache,
  VersionLoadError,
  registerVersionCache,
  versionCacheOf,
} from './version-cache'
export type { VersionLookup } from './version-cache'
