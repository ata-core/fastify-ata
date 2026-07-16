'use strict'

// Tests the @fastify/ajv-compiler-compatible factory so ata can serve as
// Fastify's GLOBAL default validator (not just a per-route compiler).

const Fastify = require('fastify')
const AtaCompiler = require('./compiler')

let pass = 0
let fail = 0

function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS  ${msg}`) }
  else { fail++; console.log(`  FAIL  ${msg}`) }
}

async function run() {
  console.log('\nfastify-ata compiler (global default) Tests\n')

  // Factory shape mirrors @fastify/ajv-compiler: factory() -> build(ext, opts) -> compile({schema}) -> validate
  const factory = AtaCompiler()
  const build = factory({}, { customOptions: {} })
  const validate = build({ schema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } })
  assert(validate({ n: 1 }) === true || (validate({ n: 1 }) && validate({ n: 1 }).value), 'compiler: valid input accepted')
  const bad = validate({})
  assert(bad === false, 'compiler: invalid input rejected')
  // The compiler path is Fastify's default-validator route: errors must be
  // the exact ajv shape (no rich fields) and mutable, because ecosystem
  // plugins like ajv-i18n assign to error.message. Rich errors belong to the
  // plugin path.
  const err0 = validate.errors && validate.errors[0]
  assert(err0 && err0.keyword && err0.message && err0.code === undefined && err0.docUrl === undefined,
    `compiler: ajv-shaped errors (got ${JSON.stringify(err0)})`)
  err0.message = 'mutated'
  assert(err0.message === 'mutated', 'compiler: error objects are mutable')

  // As Fastify's GLOBAL default via schemaController, with cross-schema $ref
  const app = Fastify({
    schemaController: { compilersFactory: { buildValidator: AtaCompiler() } },
  })
  app.addSchema({ $id: 'addr', type: 'object', properties: { city: { type: 'string' } }, required: ['city'] })
  app.post('/u', {
    schema: {
      body: {
        type: 'object',
        properties: { name: { type: 'string' }, address: { $ref: 'addr#' } },
        required: ['name', 'address'],
      },
    },
  }, (req, reply) => reply.send({ ok: true }))
  await app.ready()

  const okRes = await app.inject({ method: 'POST', url: '/u', payload: { name: 'M', address: { city: 'IST' } } })
  assert(okRes.statusCode === 200, `compiler: cross-schema $ref valid -> 200 (got ${okRes.statusCode})`)

  const badRes = await app.inject({ method: 'POST', url: '/u', payload: { name: 'M', address: {} } })
  assert(badRes.statusCode === 400, `compiler: cross-schema $ref invalid -> 400 (got ${badRes.statusCode})`)
  await app.close()

  // coerceTypes default on (matches Fastify default): querystring "5" -> 5
  const app2 = Fastify({
    schemaController: { compilersFactory: { buildValidator: AtaCompiler() } },
  })
  app2.get('/q', {
    schema: { querystring: { type: 'object', properties: { limit: { type: 'integer' } }, required: ['limit'] } },
  }, (req, reply) => reply.send({ limit: req.query.limit, typ: typeof req.query.limit }))
  await app2.ready()
  const qRes = await app2.inject({ method: 'GET', url: '/q?limit=5' })
  assert(qRes.statusCode === 200, `compiler: coerced querystring -> 200 (got ${qRes.statusCode})`)
  assert(JSON.parse(qRes.payload).typ === 'number', `compiler: querystring coerced to number (got ${qRes.payload})`)
  await app2.close()

  console.log(`\n${pass}/${pass + fail} tests passed\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((err) => { console.error(err); process.exit(1) })
