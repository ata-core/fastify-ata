'use strict'

// Verify that route schemas authored with `ata-validator/t` flow through
// fastify-ata exactly like plain JSON Schema literals do. The builder is a
// pure emitter (no runtime adapter), so the validator compiler should not
// notice the difference; this test pins that invariant so a future bump
// of ata-validator cannot silently break the TypeBox-style migration path.

const fastify = require('fastify')
const fastifyAta = require('./index')
const { t } = require('ata-validator/t')

let pass = 0
let fail = 0
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  PASS  ${msg}`) }
  else { fail++; console.log(`  FAIL  ${msg}`) }
}

async function run () {
  console.log('\nfastify-ata + ata-validator/t\n')

  const app = fastify()
  await app.register(fastifyAta)

  const Body = t.object({
    name: t.string({ minLength: 1 }),
    age: t.integer({ minimum: 0 }),
    email: t.optional(t.string({ format: 'email' })),
    role: t.union([t.literal('admin'), t.literal('user')]),
  })

  app.post('/users', { schema: { body: Body } }, (req, reply) => {
    reply.send({ ok: true, name: req.body.name, role: req.body.role })
  })

  await app.ready()
  assert(true, 'route with t-builder schema registers')

  const ok = await app.inject({
    method: 'POST',
    url: '/users',
    payload: { name: 'Mert', age: 30, role: 'admin' },
  })
  assert(ok.statusCode === 200, 'valid body returns 200')
  assert(JSON.parse(ok.payload).name === 'Mert', 'request body reachable in handler')

  const optionalOk = await app.inject({
    method: 'POST',
    url: '/users',
    payload: { name: 'Mert', age: 30, email: 'm@example.com', role: 'user' },
  })
  assert(optionalOk.statusCode === 200, 'optional field accepted when present')

  const missingRequired = await app.inject({
    method: 'POST',
    url: '/users',
    payload: { age: 30, role: 'user' },
  })
  assert(missingRequired.statusCode === 400, 'missing required field rejected')

  const wrongUnion = await app.inject({
    method: 'POST',
    url: '/users',
    payload: { name: 'Mert', age: 30, role: 'superuser' },
  })
  assert(wrongUnion.statusCode === 400, 'value outside union rejected')

  const negativeAge = await app.inject({
    method: 'POST',
    url: '/users',
    payload: { name: 'Mert', age: -1, role: 'user' },
  })
  assert(negativeAge.statusCode === 400, 'numeric bound rejected')

  await app.close()

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })
