// Compile-time types for the API client, derived from the contract registry. TYPE-ONLY imports:
// nothing here reaches the production bundle (and neither does Zod).
import type { EndpointResponse, endpoints } from '@mockbench/api-contract'

type Endpoints = typeof endpoints

/** Input/output types of a Zod schema without importing Zod (Zod 4 exposes them on `_zod`). */
type In<S> = S extends { _zod: { input: infer I } } ? I : never

type ParamsPart<E> = E extends { params: infer P } ? { params: In<P> } : unknown
type QueryPart<E> = E extends { query: infer Q }
  ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {} extends In<Q>
    ? { query?: In<Q> }
    : { query: In<Q> }
  : unknown
type BodyPart<E> = E extends { body: infer B } ? { body: In<B> } : unknown

/** `{ params?, query?, body? }`, with each key present only when the endpoint has it. */
export type ApiInput<E> = ParamsPart<E> & QueryPart<E> & BodyPart<E>

type Success<E> = Extract<EndpointResponse<E>, { status: 200 | 201 | 202 | 203 | 204 }>

/** The body of the endpoint's success response (`void` for a 204). */
export type ApiResult<E> = [Success<E>] extends [never]
  ? never
  : Success<E> extends { body: infer B }
    ? B
    : void

export interface RequestOptions {
  signal?: AbortSignal
  /** Do not fire the app-wide "session ended" redirect for a 401 (the session probe uses this). */
  skipUnauthenticatedRedirect?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type MaybeOptional<I> = {} extends I
  ? [input?: I, options?: RequestOptions]
  : [input: I, options?: RequestOptions]

export type ApiFn<E> = (...args: MaybeOptional<ApiInput<E>>) => Promise<ApiResult<E>>

/** `api.<area>.<operation>(input)`, one function per endpoint id (`projects.list` -> `api.projects.list`). */
export type Api = {
  [A in keyof Endpoints]: { [O in keyof Endpoints[A]]: ApiFn<Endpoints[A][O]> }
}
