// Main (browser-safe) entry of @mockbench/api-contract.
// The OpenAPI generator is deliberately NOT exported here: import it from
// '@mockbench/api-contract/openapi' so web bundles never include it.
export * from './primitives'
export * from './registry'
