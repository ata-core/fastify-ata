'use strict'

const fastify = require('fastify')
const fastifyAta = require('./index')
const { defineSchema } = require('ata-validator')

let pass = 0, fail = 0
function assert(cond, msg) { if (cond) { pass++; console.log('  PASS ', msg) } else { fail++; console.log('  FAIL ', msg) } }

async function run() {
  console.log('\nfastify-ata type-provider runtime smoke\n')
  const app = fastify().withTypeProvider()
  await app.register(fastifyAta)
  app.post('/u', {
    schema: { body: defineSchema({ type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } }, required: ['name'] }) },
  }, (req, reply) => reply.send({ name: req.body.name }))
  await app.ready()

  const ok = await app.inject({ method: 'POST', url: '/u', payload: { name: 'Mert', age: 26 } })
  assert(ok.statusCode === 200, `valid -> 200 (got ${ok.statusCode})`)
  assert(JSON.parse(ok.payload).name === 'Mert', 'valid -> body usable in handler')

  const bad = await app.inject({ method: 'POST', url: '/u', payload: { age: 26 } })
  assert(bad.statusCode === 400, `missing required -> 400 (got ${bad.statusCode})`)
  await app.close()

  console.log(`\n${pass}/${pass + fail} passed\n`)
  process.exit(fail > 0 ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
