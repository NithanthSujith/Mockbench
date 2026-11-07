import SwaggerParser from '@apidevtools/swagger-parser'
import { describe, expect, it } from 'vitest'
import { generateOpenApi, toOpenApiPath } from '../src/openapi'
import { fullRegistry, twoEndpointRegistry } from './fixtures'

type Doc = Awaited<ReturnType<typeof generateOpenApi>>

describe('generateOpenApi', () => {
  it('produces a document that validates as OpenAPI 3.1 (two-endpoint registry)', async () => {
    const doc = generateOpenApi(twoEndpointRegistry)
    expect(doc.openapi).toBe('3.1.0')
    // validate() throws on any schema violation. It mutates its input, so hand it a copy.
    await expect(SwaggerParser.validate(structuredClone(doc) as never)).resolves.toBeDefined()
  })

  it('also validates with a query schema, a paginated list and a 204 delete', async () => {
    const doc = generateOpenApi(fullRegistry)
    await expect(SwaggerParser.validate(structuredClone(doc) as never)).resolves.toBeDefined()
    expect(Object.keys(doc.paths ?? {}).sort()).toEqual(['/things', '/things/{thingId}'])
  })

  it('includes the shared ErrorEnvelope component and the session-cookie security scheme', () => {
    const doc: Doc = generateOpenApi(twoEndpointRegistry)
    expect(doc.components?.schemas?.ErrorEnvelope).toBeDefined()
    expect(doc.components?.securitySchemes?.mockbench_session).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'mockbench_session',
    })
  })

  it('maps paths, operation ids, security and auth level per endpoint', () => {
    const doc = generateOpenApi(fullRegistry) as never as {
      paths: Record<string, Record<string, Record<string, unknown>>>
      servers: { url: string }[]
    }
    expect(doc.servers).toEqual([{ url: '/api/v1' }])
    const get = doc.paths['/things/{thingId}']?.get
    expect(get).toMatchObject({
      operationId: 'things.get',
      tags: ['things'],
      'x-mockbench-auth': 'viewer',
    })
    expect(get?.security).toEqual([{ mockbench_session: [] }])
    const del = doc.paths['/things/{thingId}']?.delete as { responses: Record<string, unknown> }
    expect(Object.keys(del.responses)).toContain('204')
    expect(Object.keys(del.responses)).toContain('409')
  })

  it('documents implicit errors with the ErrorEnvelope and lists their codes', () => {
    const doc = generateOpenApi(twoEndpointRegistry) as never as {
      paths: Record<string, Record<string, { responses: Record<string, { description: string }> }>>
    }
    const post = doc.paths['/things']?.post
    expect(post?.responses['401']?.description).toContain('unauthenticated')
    expect(post?.responses['403']?.description).toMatch(
      /forbidden.*csrf_rejected|csrf_rejected.*forbidden/,
    )
    expect(post?.responses['409']?.description).toContain('name_taken')
    expect(post?.responses['422']?.description).toContain('validation_failed')
  })

  it('embeds each endpoint example in the media types', () => {
    const doc = generateOpenApi(twoEndpointRegistry) as never as {
      paths: Record<
        string,
        Record<string, { requestBody: { content: Record<string, { example: unknown }> } }>
      >
    }
    expect(doc.paths['/things']?.post?.requestBody.content['application/json']?.example).toEqual({
      name: 'widget',
    })
  })

  it('converts Express params to OpenAPI braces', () => {
    expect(toOpenApiPath('/a/:x/b/:yZ')).toBe('/a/{x}/b/{yZ}')
  })
})
