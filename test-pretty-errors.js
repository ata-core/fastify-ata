'use strict'

const fastify = require('fastify')
const fastifyAta = require('./index')

let pass = 0
let fail = 0

function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS  ${msg}`) }
  else { fail++; console.log(`  FAIL  ${msg}`) }
}

const schema = {
  body: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
    },
    required: ['name'],
  },
}

async function run() {
  console.log('\nfastify-ata prettyErrors Tests\n')

  // prettyErrors ON: 400 message carries the compiler-grade code + suggestion
  const app = fastify()
  await app.register(fastifyAta, { prettyErrors: true })
  app.post('/u', { schema }, (req, reply) => reply.send({ ok: true }))
  await app.ready()

  const r = await app.inject({ method: 'POST', url: '/u', payload: { age: 5 } })
  assert(r.statusCode === 400, `prettyErrors: invalid returns 400 (got ${r.statusCode})`)
  const msg = JSON.parse(r.payload).message
  assert(/ATA\d{4}/.test(msg), `prettyErrors: message carries error code (got "${msg}")`)
  assert(msg.includes('did you mean'), `prettyErrors: message carries suggestion (got "${msg}")`)
  await app.close()

  // prettyErrors OFF (default): message stays AJV-compatible, no ATA code
  const app2 = fastify()
  await app2.register(fastifyAta)
  app2.post('/u', { schema }, (req, reply) => reply.send({ ok: true }))
  await app2.ready()

  const r2 = await app2.inject({ method: 'POST', url: '/u', payload: { age: 5 } })
  assert(r2.statusCode === 400, `default: invalid returns 400 (got ${r2.statusCode})`)
  const msg2 = JSON.parse(r2.payload).message
  assert(!/ATA\d{4}/.test(msg2), `default: message has no ATA code (got "${msg2}")`)
  await app2.close()

  console.log(`\n${pass}/${pass + fail} tests passed\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
