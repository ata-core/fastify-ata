'use strict'

const fastify = require('fastify')
const fastifyAta = require('./index')

let pass = 0
let fail = 0

function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS  ${msg}`) }
  else { fail++; console.log(`  FAIL  ${msg}`) }
}

async function run() {
  console.log('\nfastify-ata Tests\n')

  // 1. Plugin registers without error
  const app = fastify()
  await app.register(fastifyAta)
  assert(true, 'plugin registers')

  // 2. Route with schema — valid request
  app.post('/user', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          age: { type: 'integer', minimum: 0 },
        },
        required: ['name'],
      },
    },
  }, (req, reply) => {
    reply.send({ ok: true, name: req.body.name })
  })

  await app.ready()
  assert(true, 'app.ready() with schema route')

  // 3. Valid request
  const r1 = await app.inject({
    method: 'POST',
    url: '/user',
    payload: { name: 'Mert', age: 26 },
  })
  assert(r1.statusCode === 200, `valid request returns 200 (got ${r1.statusCode})`)
  assert(JSON.parse(r1.payload).ok === true, 'valid request body correct')

  // 4. Invalid request — missing required
  const r2 = await app.inject({
    method: 'POST',
    url: '/user',
    payload: { age: 26 },
  })
  assert(r2.statusCode === 400, `missing required returns 400 (got ${r2.statusCode})`)

  // 5. Invalid request — wrong type
  const r3 = await app.inject({
    method: 'POST',
    url: '/user',
    payload: { name: 123 },
  })
  assert(r3.statusCode === 400, `wrong type returns 400 (got ${r3.statusCode})`)

  // 6. Multiple routes with different schemas
  const app2 = fastify()
  await app2.register(fastifyAta)

  app2.post('/a', {
    schema: { body: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'] } },
  }, (req, reply) => reply.send({ route: 'a' }))

  app2.post('/b', {
    schema: { body: { type: 'object', properties: { y: { type: 'string' } }, required: ['y'] } },
  }, (req, reply) => reply.send({ route: 'b' }))

  await app2.ready()

  const ra = await app2.inject({ method: 'POST', url: '/a', payload: { x: 1 } })
  const rb = await app2.inject({ method: 'POST', url: '/b', payload: { y: 'hello' } })
  assert(ra.statusCode === 200, 'multi-route: /a valid')
  assert(rb.statusCode === 200, 'multi-route: /b valid')

  // 7. Schema caching — same schema reuses validator
  const app3 = fastify()
  await app3.register(fastifyAta)

  const sharedSchema = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
  app3.post('/c', { schema: { body: sharedSchema } }, (req, reply) => reply.send({ ok: true }))
  app3.post('/d', { schema: { body: sharedSchema } }, (req, reply) => reply.send({ ok: true }))

  await app3.ready()
  const rc = await app3.inject({ method: 'POST', url: '/c', payload: { id: 1 } })
  const rd = await app3.inject({ method: 'POST', url: '/d', payload: { id: 2 } })
  assert(rc.statusCode === 200 && rd.statusCode === 200, 'schema caching works')

  // 8. Error message is descriptive
  const errBody = JSON.parse(r2.payload)
  assert(errBody.message && errBody.message.length > 0, `error message present: "${errBody.message}"`)

  await app.close()
  await app2.close()
  await app3.close()

  console.log(`\n${pass}/${pass + fail} tests passed\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
