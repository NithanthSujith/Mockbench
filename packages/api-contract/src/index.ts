// Main (browser-safe) entry of @mockbench/api-contract.
// The OpenAPI generator is deliberately NOT exported here: import it from
// '@mockbench/api-contract/openapi' so web bundles never include it.
export * from './primitives'
export * from './registry'
export * from './paths'
export * from './rules'
export * from './validation'
export * from './resources'
export * from './dataplane'
export * from './examples'
export { endpoints, registry } from './endpoints'
