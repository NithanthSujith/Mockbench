// DATA PLANE (`/mock/:slug/*`) — FND-10 STUB. RUN-05 replaces the body of this router.
//
// Contract with the rest of the app (do not break when implementing): this router is mounted FIRST,
// at `/mock`, before any cookie parsing, session lookup, CSRF guard or JSON body parsing, and it has
// its OWN error handler. Errors it generates carry `X-Mock-Error: true` and the body
// `{ error, message, hint }` (API-CONTRACT 4.5) - never the control-plane envelope.
import express from 'express'
import type { Router } from 'express'
import type { Logger } from 'pino'

export interface DataPlaneDeps {
  logger: Logger
}

export function createDataPlaneRouter(deps: DataPlaneDeps): Router {
  const log = deps.logger.child({ plane: 'data' })
  const router = express.Router()

  router.use((_req, res) => {
    res
      .status(501)
      .set('X-Mock-Error', 'true')
      .type('application/json')
      .send(
        JSON.stringify({
          error: 'not_implemented',
          message: 'The mock data plane is not implemented yet.',
          hint: 'It arrives with unit RUN-05.',
        }),
      )
  })

  // Four-argument signature is what makes Express treat this as an error handler.
  router.use(
    (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) return next(err)
      log.error({ err }, 'data plane error')
      res
        .status(500)
        .set('X-Mock-Error', 'true')
        .type('application/json')
        .send(
          JSON.stringify({
            error: 'mock_internal_error',
            message: 'The mock server hit an unexpected error.',
            hint: 'Check the api logs.',
          }),
        )
    },
  )

  return router
}
