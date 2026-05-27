// Migration from TypeBox to ata-validator/t on a Fastify route. The diff is
// one import rename: `@sinclair/typebox` becomes `ata-validator/t`, `Type`
// becomes `t`. Authoring shape stays identical, and the type provider keeps
// inferring `request.body` exactly the same way. The runtime moves to ata,
// and the same schema can be ahead-of-time precompiled into a standalone
// module with no validator dependency.
//
// Type-check: npx tsc --noEmit --strict --esModuleInterop examples/typebox-migration.ts

import Fastify from 'fastify'

// --- before: TypeBox + @fastify/type-provider-typebox ----------------------
import { Type, type Static } from '@sinclair/typebox'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'

const TbUser = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 1 }),
  email: Type.Optional(Type.String({ format: 'email' })),
  role: Type.Union([Type.Literal('admin'), Type.Literal('user')]),
})
type TbUserT = Static<typeof TbUser>

const tbApp = Fastify().withTypeProvider<TypeBoxTypeProvider>()
tbApp.post('/users', { schema: { body: TbUser } }, async (req) => {
  const id: number = req.body.id
  const role: 'admin' | 'user' = req.body.role
  void id; void role
  return { ok: true }
})

// --- after: ata-validator/t + fastify-ata ----------------------------------
// Diff vs the block above: two imports renamed. Authoring shape unchanged.
import { t } from 'ata-validator/t'
import type { Infer } from 'ata-validator'
import fastifyAta = require('../index')

const AtaUser = t.object({
  id: t.integer({ minimum: 1 }),
  name: t.string({ minLength: 1 }),
  email: t.optional(t.string({ format: 'email' })),
  role: t.union([t.literal('admin'), t.literal('user')]),
})
type AtaUserT = Infer<typeof AtaUser>

const ataApp = Fastify().withTypeProvider<fastifyAta.AtaTypeProvider>()
ataApp.post('/users', { schema: { body: AtaUser } }, async (req) => {
  const id: number = req.body.id
  const role: 'admin' | 'user' = req.body.role
  void id; void role
  return { ok: true }
})

// --- proof the inferred type is the same shape on both sides ---------------
type Expect<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const _sameShape: Expect<TbUserT, AtaUserT> = true
void _sameShape

// --- bonus: ata can also precompile the schema to a standalone module ------
// `t.object(...)` emits plain JSON Schema, so the same `AtaUser` value goes
// straight into the AOT path. Compile with:
//
//   npx ata compile examples/typebox-migration.user.json -o examples/user.validator.mjs
//
// (you can serialize AtaUser with JSON.stringify to get the input file). The
// generated `.mjs` is a zero-dependency module: imports nothing from
// ata-validator, no `eval`, CSP-safe, ~2 KB gzipped for this schema. Ship the
// generated file to the browser or to an edge worker and validate without
// pulling either ata or TypeBox into the runtime bundle.
