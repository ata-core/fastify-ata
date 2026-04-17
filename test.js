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

  // 9. Ajv-style error format — FST_ERR_VALIDATION and AJV message
  const r4 = await app.inject({
    method: 'POST',
    url: '/user',
    payload: { name: 123 },
  })
  const errBody4 = JSON.parse(r4.payload)
  assert(r4.statusCode === 400, `ajv-style: returns 400 (got ${r4.statusCode})`)
  assert(errBody4.message.includes('must be'), `ajv-style: AJV message format: "${errBody4.message}"`)

  // 10. Coercion support
  const app4 = fastify()
  await app4.register(fastifyAta, { coerceTypes: true })
  app4.post('/coerce', {
    schema: {
      body: {
        type: 'object',
        properties: { count: { type: 'integer' } },
        required: ['count'],
      },
    },
  }, (req, reply) => {
    reply.send({ count: req.body.count, type: typeof req.body.count })
  })
  await app4.ready()
  const r5 = await app4.inject({
    method: 'POST',
    url: '/coerce',
    payload: { count: '42' },
  })
  assert(r5.statusCode === 200, `coercion: returns 200 (got ${r5.statusCode})`)
  const body5 = JSON.parse(r5.payload)
  assert(body5.count === 42, `coercion: count coerced to integer (got ${body5.count})`)
  assert(body5.type === 'number', `coercion: type is number (got ${body5.type})`)
  await app4.close()

  // 11. removeAdditional support
  const app5 = fastify()
  await app5.register(fastifyAta, { removeAdditional: true })
  app5.post('/strip', {
    schema: {
      body: {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      },
    },
  }, (req, reply) => {
    reply.send(req.body)
  })
  await app5.ready()
  const r6 = await app5.inject({
    method: 'POST',
    url: '/strip',
    payload: { name: 'Mert', extra: 'gone' },
  })
  assert(r6.statusCode === 200, `removeAdditional: returns 200 (got ${r6.statusCode})`)
  const body6 = JSON.parse(r6.payload)
  assert(body6.name === 'Mert', `removeAdditional: name preserved`)
  assert(body6.extra === undefined, `removeAdditional: extra stripped (got ${JSON.stringify(body6)})`)
  await app5.close()

  // 12. Nested schema validation error
  const app6 = fastify()
  await app6.register(fastifyAta)
  app6.post('/nested', {
    schema: {
      body: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: { email: { type: 'string', format: 'email' } },
            required: ['email'],
          },
        },
      },
    },
  }, (req, reply) => reply.send({ ok: true }))
  await app6.ready()
  const r7 = await app6.inject({
    method: 'POST',
    url: '/nested',
    payload: { user: {} },
  })
  assert(r7.statusCode === 400, `nested: returns 400 (got ${r7.statusCode})`)
  const errBody7 = JSON.parse(r7.payload)
  assert(errBody7.message.includes('email'), `nested: message mentions email: "${errBody7.message}"`)
  await app6.close()

  // --- Fastify-realistic schema features ---

  // 13. enum validation
  const app7 = fastify()
  await app7.register(fastifyAta)
  app7.post('/enum', {
    schema: { body: { type: 'object', properties: { role: { type: 'string', enum: ['admin', 'user', 'guest'] } }, required: ['role'] } },
  }, (req, reply) => reply.send({ ok: true }))
  await app7.ready()
  const re1 = await app7.inject({ method: 'POST', url: '/enum', payload: { role: 'admin' } })
  const re2 = await app7.inject({ method: 'POST', url: '/enum', payload: { role: 'hacker' } })
  assert(re1.statusCode === 200, 'enum: valid value accepted')
  assert(re2.statusCode === 400, `enum: invalid value rejected (got ${re2.statusCode})`)
  await app7.close()

  // 14. additionalProperties: false
  const app8 = fastify()
  await app8.register(fastifyAta)
  app8.post('/strict', {
    schema: { body: { type: 'object', properties: { id: { type: 'integer' } }, additionalProperties: false } },
  }, (req, reply) => reply.send({ ok: true }))
  await app8.ready()
  const rs1 = await app8.inject({ method: 'POST', url: '/strict', payload: { id: 1 } })
  const rs2 = await app8.inject({ method: 'POST', url: '/strict', payload: { id: 1, extra: 'x' } })
  assert(rs1.statusCode === 200, 'additionalProperties: valid accepted')
  assert(rs2.statusCode === 400, `additionalProperties: extra rejected (got ${rs2.statusCode})`)
  await app8.close()

  // 15. array items validation
  const app9 = fastify()
  await app9.register(fastifyAta)
  app9.post('/items', {
    schema: { body: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' }, minItems: 1 } }, required: ['tags'] } },
  }, (req, reply) => reply.send({ ok: true }))
  await app9.ready()
  const ri1 = await app9.inject({ method: 'POST', url: '/items', payload: { tags: ['a', 'b'] } })
  const ri2 = await app9.inject({ method: 'POST', url: '/items', payload: { tags: [] } })
  const ri3 = await app9.inject({ method: 'POST', url: '/items', payload: { tags: ['a', 123] } })
  assert(ri1.statusCode === 200, 'array items: valid accepted')
  assert(ri2.statusCode === 400, `array items: empty rejected (got ${ri2.statusCode})`)
  assert(ri3.statusCode === 400, `array items: wrong type rejected (got ${ri3.statusCode})`)
  await app9.close()

  // 16. allOf composition
  const app10 = fastify()
  await app10.register(fastifyAta)
  app10.post('/allof', {
    schema: { body: { allOf: [
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      { type: 'object', properties: { b: { type: 'integer' } }, required: ['b'] },
    ] } },
  }, (req, reply) => reply.send({ ok: true }))
  await app10.ready()
  const ra1 = await app10.inject({ method: 'POST', url: '/allof', payload: { a: 'x', b: 1 } })
  const ra2 = await app10.inject({ method: 'POST', url: '/allof', payload: { a: 'x' } })
  assert(ra1.statusCode === 200, 'allOf: both present accepted')
  assert(ra2.statusCode === 400, `allOf: missing b rejected (got ${ra2.statusCode})`)
  await app10.close()

  // 17. anyOf composition
  const app11 = fastify()
  await app11.register(fastifyAta)
  app11.post('/anyof', {
    schema: { body: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
  }, (req, reply) => reply.send({ ok: true }))
  await app11.ready()
  const rao1 = await app11.inject({ method: 'POST', url: '/anyof', payload: '"hello"', headers: { 'content-type': 'application/json' } })
  const rao2 = await app11.inject({ method: 'POST', url: '/anyof', payload: '42', headers: { 'content-type': 'application/json' } })
  const rao3 = await app11.inject({ method: 'POST', url: '/anyof', payload: 'true', headers: { 'content-type': 'application/json' } })
  assert(rao1.statusCode === 200, 'anyOf: string accepted')
  assert(rao2.statusCode === 200, 'anyOf: integer accepted')
  assert(rao3.statusCode === 400, `anyOf: boolean rejected (got ${rao3.statusCode})`)
  await app11.close()

  // 18. format validation (email)
  const app12 = fastify()
  await app12.register(fastifyAta)
  app12.post('/format', {
    schema: { body: { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] } },
  }, (req, reply) => reply.send({ ok: true }))
  await app12.ready()
  const rf1 = await app12.inject({ method: 'POST', url: '/format', payload: { email: 'a@b.com' } })
  const rf2 = await app12.inject({ method: 'POST', url: '/format', payload: { email: 'not-email' } })
  assert(rf1.statusCode === 200, 'format: valid email accepted')
  assert(rf2.statusCode === 400, `format: invalid email rejected (got ${rf2.statusCode})`)
  await app12.close()

  // 19. numeric constraints (minimum, maximum, exclusiveMinimum)
  const app13 = fastify()
  await app13.register(fastifyAta)
  app13.post('/numeric', {
    schema: { body: { type: 'object', properties: { age: { type: 'integer', minimum: 0, maximum: 150 }, score: { type: 'number', exclusiveMinimum: 0 } } } },
  }, (req, reply) => reply.send({ ok: true }))
  await app13.ready()
  const rn1 = await app13.inject({ method: 'POST', url: '/numeric', payload: { age: 25, score: 0.1 } })
  const rn2 = await app13.inject({ method: 'POST', url: '/numeric', payload: { age: -1 } })
  const rn3 = await app13.inject({ method: 'POST', url: '/numeric', payload: { score: 0 } })
  assert(rn1.statusCode === 200, 'numeric: valid accepted')
  assert(rn2.statusCode === 400, `numeric: age < 0 rejected (got ${rn2.statusCode})`)
  assert(rn3.statusCode === 400, `numeric: score = 0 rejected by exclusiveMinimum (got ${rn3.statusCode})`)
  await app13.close()

  // 20. $ref with $defs
  const app14 = fastify()
  await app14.register(fastifyAta)
  app14.post('/ref', {
    schema: { body: {
      type: 'object',
      properties: { address: { $ref: '#/$defs/Address' } },
      $defs: { Address: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
    } },
  }, (req, reply) => reply.send({ ok: true }))
  await app14.ready()
  const rr1 = await app14.inject({ method: 'POST', url: '/ref', payload: { address: { city: 'Istanbul' } } })
  const rr2 = await app14.inject({ method: 'POST', url: '/ref', payload: { address: {} } })
  assert(rr1.statusCode === 200, '$ref: valid address accepted')
  assert(rr2.statusCode === 400, `$ref: missing city rejected (got ${rr2.statusCode})`)
  await app14.close()

  // 21. querystring validation
  const app15 = fastify()
  await app15.register(fastifyAta)
  app15.get('/search', {
    schema: { querystring: { type: 'object', properties: { q: { type: 'string', minLength: 1 }, page: { type: 'string' } }, required: ['q'] } },
  }, (req, reply) => reply.send({ q: req.query.q }))
  await app15.ready()
  const rq1 = await app15.inject({ method: 'GET', url: '/search?q=hello&page=1' })
  const rq2 = await app15.inject({ method: 'GET', url: '/search' })
  assert(rq1.statusCode === 200, 'querystring: valid accepted')
  assert(rq2.statusCode === 400, `querystring: missing q rejected (got ${rq2.statusCode})`)
  await app15.close()

  // 22. params validation
  const app16 = fastify()
  await app16.register(fastifyAta)
  app16.get('/users/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'] } },
  }, (req, reply) => reply.send({ id: req.params.id }))
  await app16.ready()
  const rp1 = await app16.inject({ method: 'GET', url: '/users/42' })
  assert(rp1.statusCode === 200, 'params: valid id accepted')
  await app16.close()

  // 23. headers validation
  const app17 = fastify()
  await app17.register(fastifyAta)
  app17.get('/auth', {
    schema: { headers: { type: 'object', properties: { 'x-api-key': { type: 'string', minLength: 10 } }, required: ['x-api-key'] } },
  }, (req, reply) => reply.send({ ok: true }))
  await app17.ready()
  const rh1 = await app17.inject({ method: 'GET', url: '/auth', headers: { 'x-api-key': 'abcdefghij' } })
  const rh2 = await app17.inject({ method: 'GET', url: '/auth', headers: {} })
  assert(rh1.statusCode === 200, 'headers: valid api key accepted')
  assert(rh2.statusCode === 400, `headers: missing api key rejected (got ${rh2.statusCode})`)
  await app17.close()

  await app.close()
  await app2.close()
  await app3.close()

  /* Turbo mode tests removed - turbo mode deprecated */
  /*

  // 13. Turbo mode: plugin registers
  const tApp = fastify()
  await tApp.register(fastifyAta, { turbo: true })
  tApp.post('/user', {
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
  await tApp.ready()
  assert(true, 'turbo: plugin registers')

  // 14. Turbo: valid request
  const t1 = await tApp.inject({
    method: 'POST',
    url: '/user',
    payload: { name: 'Mert', age: 26 },
  })
  assert(t1.statusCode === 200, `turbo: valid request returns 200 (got ${t1.statusCode})`)
  assert(JSON.parse(t1.payload).name === 'Mert', 'turbo: valid request body correct')

  // 15. Turbo: invalid request (missing required)
  const t2 = await tApp.inject({
    method: 'POST',
    url: '/user',
    payload: { age: 26 },
  })
  assert(t2.statusCode === 400, `turbo: missing required returns 400 (got ${t2.statusCode})`)

  // 16. Turbo: invalid request (wrong type)
  const t3 = await tApp.inject({
    method: 'POST',
    url: '/user',
    payload: { name: 123 },
  })
  assert(t3.statusCode === 400, `turbo: wrong type returns 400 (got ${t3.statusCode})`)

  // 17. Turbo: error message format
  const tErr = JSON.parse(t2.payload)
  assert(tErr.message && tErr.message.length > 0, `turbo: error message present: "${tErr.message}"`)

  // 18. Turbo: malformed JSON body
  const t4 = await tApp.inject({
    method: 'POST',
    url: '/user',
    headers: { 'content-type': 'application/json' },
    body: '{not valid json',
  })
  assert(t4.statusCode === 400, `turbo: malformed JSON returns 400 (got ${t4.statusCode})`)

  // 19. Turbo: nested object validation
  const tApp2 = fastify()
  await tApp2.register(fastifyAta, { turbo: true })
  tApp2.post('/nested', {
    schema: {
      body: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: { email: { type: 'string', format: 'email' } },
            required: ['email'],
          },
        },
      },
    },
  }, (req, reply) => reply.send({ ok: true }))
  await tApp2.ready()
  const t5 = await tApp2.inject({
    method: 'POST',
    url: '/nested',
    payload: { user: {} },
  })
  assert(t5.statusCode === 400, `turbo: nested validation returns 400 (got ${t5.statusCode})`)
  const tErr2 = JSON.parse(t5.payload)
  assert(tErr2.message.includes('email'), `turbo: nested error mentions email: "${tErr2.message}"`)
  await tApp2.close()

  // 20. Turbo: multiple routes
  const tApp3 = fastify()
  await tApp3.register(fastifyAta, { turbo: true })
  tApp3.post('/a', {
    schema: { body: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'] } },
  }, (req, reply) => reply.send({ route: 'a', x: req.body.x }))
  tApp3.post('/b', {
    schema: { body: { type: 'object', properties: { y: { type: 'string' } }, required: ['y'] } },
  }, (req, reply) => reply.send({ route: 'b', y: req.body.y }))
  await tApp3.ready()
  const ta = await tApp3.inject({ method: 'POST', url: '/a', payload: { x: 42 } })
  const tb = await tApp3.inject({ method: 'POST', url: '/b', payload: { y: 'hello' } })
  assert(ta.statusCode === 200, 'turbo: multi-route /a valid')
  assert(tb.statusCode === 200, 'turbo: multi-route /b valid')
  assert(JSON.parse(ta.payload).x === 42, 'turbo: multi-route /a body correct')
  assert(JSON.parse(tb.payload).y === 'hello', 'turbo: multi-route /b body correct')
  await tApp3.close()

  await tApp.close()
  */

  console.log(`\n${pass}/${pass + fail} tests passed\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
