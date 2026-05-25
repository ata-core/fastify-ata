// The same Fastify route, typed two ways.
//
// TypeBox: you write the schema in the Type.* builder DSL, and the app ships
//   the @sinclair/typebox runtime to every environment it runs in.
// ata: you write plain JSON Schema (the thing you already have from an
//   OpenAPI doc, a shared registry, or a config file). request.body narrows
//   exactly the same, and you can compile that schema to a standalone,
//   zero-dependency validator you ship instead of the library.
//
// Type-check: tsc --noEmit --strict examples/typebox-vs-ata.ts
// Both handlers below narrow request.body to the discriminated union with no
// manual annotation. The only difference is where the schema comes from.

import Fastify from 'fastify'
import { Type } from '@sinclair/typebox'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { defineSchema } from 'ata-validator'
import fastifyAta = require('../index')

// exact-type equality helper, so the assertions below are real
type Expect<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// ---------------------------------------------------------------------------
// TypeBox: the builder DSL
// ---------------------------------------------------------------------------
const TbEvent = Type.Union([
  Type.Object({ kind: Type.Literal('click'), at: Type.Object({ x: Type.Number(), y: Type.Number() }) }),
  Type.Object({ kind: Type.Literal('key'), code: Type.String() }),
])

const tbApp = Fastify().withTypeProvider<TypeBoxTypeProvider>()
tbApp.post('/event', { schema: { body: TbEvent } }, async (req) => {
  if (req.body.kind === 'click') {
    const x: number = req.body.at.x // narrows on the discriminant
    void x
  }
  return { ok: true }
})

// ---------------------------------------------------------------------------
// ata: plain JSON Schema, with $ref reuse, no builder
// ---------------------------------------------------------------------------
const ataEvent = defineSchema({
  $defs: {
    Point: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
  },
  anyOf: [
    { type: 'object', properties: { kind: { const: 'click' }, at: { $ref: '#/$defs/Point' } }, required: ['kind', 'at'] },
    { type: 'object', properties: { kind: { const: 'key' }, code: { type: 'string' } }, required: ['kind', 'code'] },
  ],
})

const ataApp = Fastify().withTypeProvider<fastifyAta.AtaTypeProvider>()
ataApp.post('/event', { schema: { body: ataEvent } }, async (req) => {
  if (req.body.kind === 'click') {
    const x: number = req.body.at.x // same narrowing, from plain JSON Schema
    void x
  }
  // prove the inferred body matches the discriminated union exactly
  const _exact: Expect<
    typeof req.body,
    | { kind: 'click'; at: { x: number; y: number } }
    | { kind: 'key'; code: string }
  > = true
  void _exact
  return { ok: true }
})
