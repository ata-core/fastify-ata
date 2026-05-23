// Type-level test. Compiled with `tsc -p tsconfig.types.json` (no emit).
// A type error here = failure. Asserts the type provider narrows request types.
import Fastify from 'fastify'
import { defineSchema } from 'ata-validator'
import fastifyAta = require('./index')
type AtaTypeProvider = fastifyAta.AtaTypeProvider

// exact-type equality helper
type Expect<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const app = Fastify().withTypeProvider<AtaTypeProvider>()

app.post('/users', {
  schema: {
    body: defineSchema({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
      required: ['name'],
    }),
  },
}, async (req) => {
  // body must narrow: name required string, age optional number
  const _name: string = req.body.name
  const _age: number | undefined = req.body.age
  const _exact: Expect<typeof req.body, { name: string; age?: number }> = true
  void _name; void _age; void _exact
  return { ok: true }
})

app.get('/search', {
  schema: {
    querystring: defineSchema({ type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }),
  },
}, async (req) => {
  const _q: string = req.query.q
  void _q
  return { ok: true }
})
