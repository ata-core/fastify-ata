// End-to-end demo of the ata type provider on a realistic API surface:
// typed params, querystring coercion, a discriminated-union body, response
// schemas through the serializer, and the default error shape on a 400.
//
// Every request.* access below is typed from the schema literal alone; there
// is not a single manual type annotation or `as` cast in the route handlers.
//
// Type-check: npx tsc --noEmit --strict --esModuleInterop examples/typed-api-demo.ts
// Run:        node examples/typed-api-demo.ts   (asserts runtime behavior, exits 0)

import Fastify from 'fastify'
import { defineSchema } from 'ata-validator'
import { strict as assert } from 'node:assert'
import fastifyAta from '../index.js'

const paramsSchema = defineSchema({
  type: 'object',
  properties: { id: { type: 'integer', minimum: 1 } },
  required: ['id'],
})

const querySchema = defineSchema({
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    kind: { type: 'string', enum: ['click', 'scroll'] },
  },
  required: [],
})

// Discriminated union: the payload is either a click or a scroll event.
const eventSchema = defineSchema({
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'click' },
        x: { type: 'integer' },
        y: { type: 'integer' },
      },
      required: ['kind', 'x', 'y'],
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'scroll' },
        delta: { type: 'number' },
      },
      required: ['kind', 'delta'],
    },
  ],
})

const eventReply = defineSchema({
  type: 'object',
  properties: {
    accepted: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['accepted', 'summary'],
})

async function main() {
  const app = Fastify().withTypeProvider<fastifyAta.AtaTypeProvider>()
  await app.register(fastifyAta)

  app.get(
    '/events/:id',
    { schema: { params: paramsSchema, querystring: querySchema } },
    async (req) => {
      // req.params.id is number (coerced from the path string by the validator)
      const id: number = req.params.id
      // req.query.limit is number | undefined at the type level; the default
      // is applied at runtime before the handler runs.
      const limit: number | undefined = req.query.limit
      // req.query.kind narrows to the enum literals.
      const kind: 'click' | 'scroll' | undefined = req.query.kind
      return { id, limit: limit ?? -1, kind: kind ?? 'none' }
    },
  )

  app.post(
    '/events',
    { schema: { body: eventSchema, response: { 200: eventReply } } },
    async (req) => {
      // The union narrows on the discriminant, exactly like a hand-written
      // discriminated union type.
      if (req.body.kind === 'click') {
        const x: number = req.body.x
        const y: number = req.body.y
        return { accepted: true, summary: `click at ${x},${y}` }
      }
      const delta: number = req.body.delta
      return { accepted: true, summary: `scroll by ${delta}` }
    },
  )

  await app.ready()

  // 1. Params coercion: "42" in the path arrives as number 42.
  const r1 = await app.inject({ method: 'GET', url: '/events/42?kind=click' })
  assert.equal(r1.statusCode, 200)
  assert.deepEqual(r1.json(), { id: 42, limit: 20, kind: 'click' })
  console.log('ok: params coerced to number, query default applied, enum narrowed')

  // 2. Invalid param: not an integer -> default Fastify 400 shape.
  const r2 = await app.inject({ method: 'GET', url: '/events/zero?kind=click' })
  assert.equal(r2.statusCode, 400)
  assert.match(r2.json().message, /params\/id/)
  console.log('ok: invalid param -> 400 with the default error shape:', JSON.stringify(r2.json().message))

  // 3. Enum violation in querystring.
  const r3 = await app.inject({ method: 'GET', url: '/events/1?kind=hover' })
  assert.equal(r3.statusCode, 400)
  console.log('ok: enum violation -> 400')

  // 4. Union body, both branches.
  const r4 = await app.inject({
    method: 'POST',
    url: '/events',
    payload: { kind: 'click', x: 10, y: 20 },
  })
  assert.deepEqual(r4.json(), { accepted: true, summary: 'click at 10,20' })
  const r5 = await app.inject({
    method: 'POST',
    url: '/events',
    payload: { kind: 'scroll', delta: 3.5 },
  })
  assert.deepEqual(r5.json(), { accepted: true, summary: 'scroll by 3.5' })
  console.log('ok: both union branches validate and narrow')

  // 5. Wrong-shape union body: click without coordinates.
  const r6 = await app.inject({
    method: 'POST',
    url: '/events',
    payload: { kind: 'click' },
  })
  assert.equal(r6.statusCode, 400)
  console.log('ok: incomplete union branch -> 400')

  // 6. Response schema went through the serializer: extra fields are dropped.
  const r7 = await app.inject({
    method: 'POST',
    url: '/events',
    payload: { kind: 'scroll', delta: 1 },
  })
  assert.deepEqual(Object.keys(r7.json()).sort(), ['accepted', 'summary'])
  console.log('ok: response serialized against the reply schema')

  await app.close()
  console.log('\ntyped-api-demo: all runtime assertions passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
