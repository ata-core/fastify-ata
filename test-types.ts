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

// anyOf body narrows to a union
app.post('/event', {
  schema: {
    body: defineSchema({
      anyOf: [
        { type: 'object', properties: { kind: { const: 'a' }, n: { type: 'number' } }, required: ['kind', 'n'] },
        { type: 'object', properties: { kind: { const: 'b' }, s: { type: 'string' } }, required: ['kind', 's'] },
      ],
    }),
  },
}, async (req) => {
  const _exact: Expect<typeof req.body, { kind: 'a'; n: number } | { kind: 'b'; s: string }> = true
  void _exact
  return { ok: true }
})

// $ref body resolves the referenced $defs entry
app.post('/place', {
  schema: {
    body: defineSchema({
      $defs: { Point: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
      type: 'object',
      properties: { at: { $ref: '#/$defs/Point' } },
      required: ['at'],
    }),
  },
}, async (req) => {
  const _x: number = req.body.at.x
  const _exact: Expect<typeof req.body, { at: { x: number; y: number } }> = true
  void _x; void _exact
  return { ok: true }
})

// allOf body narrows to an intersection
app.post('/merged', {
  schema: {
    body: defineSchema({
      allOf: [
        { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] },
      ],
    }),
  },
}, async (req) => {
  const _exact: Expect<typeof req.body, { a: number; b: string }> = true
  void _exact
  return { ok: true }
})
