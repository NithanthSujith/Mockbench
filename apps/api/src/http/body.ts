// JSON request-body reading for the control plane (API-CONTRACT 1.1):
//  - any non-empty body must be `application/json`        -> 415 unsupported_media_type
//  - over the size limit                                   -> 413 payload_too_large
//  - not parseable                                         -> 400 invalid_json
// Hand-rolled (not express.json) because the contract needs distinct codes for each failure.
import type { Request } from 'express'
import { HttpError } from './errors'

export const DEFAULT_BODY_LIMIT = 1024 * 1024
export const IMPORT_BODY_LIMIT = 10 * 1024 * 1024

function readRaw(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'])
    const chunks: Buffer[] = []
    let total = 0
    let tooLarge = Number.isFinite(declared) && declared > limit
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return // keep draining so the connection stays usable, but keep nothing
      total += chunk.length
      if (total > limit) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        reject(
          new HttpError(
            413,
            'payload_too_large',
            `The request body is larger than ${Math.round(limit / 1024 / 1024)} MiB.`,
          ),
        )
      } else {
        resolve(Buffer.concat(chunks))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Returns the parsed JSON body, or `undefined` when the request has no body. A request that does
 * have a body but is not JSON is rejected even when the endpoint declares no body schema.
 */
export async function readJsonBody(req: Request, limit: number): Promise<unknown> {
  const raw = await readRaw(req, limit)
  if (raw.length === 0) return undefined
  const contentType = String(req.headers['content-type'] ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase()
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', 'Send the request body as application/json.')
  }
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON.')
  }
}
