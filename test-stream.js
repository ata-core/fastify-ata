'use strict'

const fastify = require('fastify')
const fastifyAtaStream = require('./stream')

let pass = 0
let fail = 0

function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS  ${msg}`) }
  else { fail++; console.log(`  FAIL  ${msg}`) }
}

const record = {
  type: 'object',
  properties: { id: { type: 'integer', minimum: 1 }, email: { type: 'string', format: 'email' } },
  required: ['id', 'email'],
  additionalProperties: false,
}

async function build(opts = {}, serverOpts = {}) {
  const app = fastify(serverOpts)
  await app.register(fastifyAtaStream, opts)
  app.post('/import', { config: { records: record } }, async (req) => ({ got: req.body.length, last: req.body[req.body.length - 1] }))
  app.post('/count', { config: { records: record, collect: false } }, async (req) => req.body)
  app.post('/small', { config: { records: record }, bodyLimit: 64 }, async (req) => ({ got: req.body.length }))
  app.post('/plain', async (req) => ({ echo: req.body }))
  app.post('/plain-schema', { schema: { body: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } } }, async (req) => ({ n: req.body.n }))
  return app
}

async function run() {
  console.log('\nfastify-ata/stream Tests\n')
  const app = await build()

  // 1. ndjson records reach the handler as an array
  let res = await app.inject({ method: 'POST', url: '/import', headers: { 'content-type': 'application/x-ndjson' }, payload: '{"id":1,"email":"a@b.co"}\n{"id":2,"email":"c@d.co"}\n' })
  assert(res.statusCode === 200 && res.json().got === 2 && res.json().last.id === 2, 'ndjson body: two records, both in the handler')

  // 2. a JSON array works the same way
  res = await app.inject({ method: 'POST', url: '/import', headers: { 'content-type': 'application/json' }, payload: '[{"id":1,"email":"a@b.co"},{"id":2,"email":"c@d.co"}]' })
  assert(res.statusCode === 200 && res.json().got === 2, 'json array body: two records')

  // 3. the first failing record answers 400 with its index and the errors
  res = await app.inject({ method: 'POST', url: '/import', headers: { 'content-type': 'application/x-ndjson' }, payload: '{"id":1,"email":"a@b.co"}\n{"id":2,"email":"not-an-email"}\n{"id":3,"email":"e@f.co"}\n' })
  let body = res.json()
  assert(res.statusCode === 400 && body.code === 'FST_ERR_ATA_STREAM_RECORD', `invalid second record: 400 ${body.code}`)
  assert(/record 1\/email/.test(body.message), `message names the record and the path: ${body.message}`)

  // 4. a record that is not JSON is a parse failure at its index
  res = await app.inject({ method: 'POST', url: '/import', headers: { 'content-type': 'application/x-ndjson' }, payload: '{"id":1,"email":"a@b.co"}\n{"id":2,\n' })
  body = res.json()
  assert(res.statusCode === 400 && body.code === 'FST_ERR_ATA_STREAM_PARSE' && /record 1/.test(body.message), `broken record: 400 ${body.code} ${body.message}`)

  // 5. an empty body is zero records
  res = await app.inject({ method: 'POST', url: '/import', headers: { 'content-type': 'application/x-ndjson' }, payload: '' })
  assert(res.statusCode === 200 && res.json().got === 0, 'empty body: zero records')

  // 6. collect: false hands the handler only the count
  res = await app.inject({ method: 'POST', url: '/count', headers: { 'content-type': 'application/x-ndjson' }, payload: '{"id":1,"email":"a@b.co"}\n{"id":2,"email":"c@d.co"}\n{"id":3,"email":"e@f.co"}\n' })
  assert(res.statusCode === 200 && res.json().records === 3, 'collect false: the count, not the records')

  // 7. the route bodyLimit holds on a record route: 413, by content-length and by bytes
  const big = '{"id":1,"email":"a@b.co"}\n'.repeat(10)
  res = await app.inject({ method: 'POST', url: '/small', headers: { 'content-type': 'application/x-ndjson' }, payload: big })
  assert(res.statusCode === 413 && res.json().code === 'FST_ERR_CTP_BODY_TOO_LARGE', 'over the route bodyLimit: 413 FST_ERR_CTP_BODY_TOO_LARGE')
  res = await app.inject({ method: 'POST', url: '/small', headers: { 'content-type': 'application/x-ndjson', 'transfer-encoding': 'chunked' }, payload: big })
  assert(res.statusCode === 413, 'over the route bodyLimit without content-length: 413')

  // 8. the failure comes before the body ends: over a real connection a chunked
  //    body that never ends gets its 400 while it is still being sent, and the
  //    server closes the connection instead of draining it
  {
    const http = require('node:http')
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address()
    const outcome = await new Promise((resolve) => {
      let written = 0
      let timer = null
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/import', headers: { 'content-type': 'application/x-ndjson', 'transfer-encoding': 'chunked' } })
      req.on('response', (r) => {
        let text = ''
        r.on('data', (d) => { text += d })
        r.on('end', () => {
          const sawClose = new Promise((ok) => { req.socket.on('close', () => ok(true)); setTimeout(() => ok(false), 2000) })
          sawClose.then((closed) => { clearInterval(timer); resolve({ status: r.statusCode, body: JSON.parse(text), written, closed }) })
        })
      })
      req.on('error', (e) => { clearInterval(timer); resolve({ status: 0, body: { code: e.code }, written, closed: false }) })
      setTimeout(() => { clearInterval(timer); req.destroy(); resolve({ status: 0, body: { code: 'TIMEOUT' }, written, closed: false }) }, 5000)
      req.write('{"id":1,"email":"a@b.co"}\n{"id":"x","email":"a@b.co"}\n')
      timer = setInterval(() => { if (!req.destroyed && req.writable) { req.write('{"id":1,"email":"a@b.co"}\n'); written++ } }, 1)
    })
    assert(outcome.status === 400 && outcome.body.code === 'FST_ERR_ATA_STREAM_RECORD', `endless body: 400 at the second record, ${outcome.written} chunks still being sent`)
    assert(outcome.closed, 'the server closed the connection instead of reading the body to its end')
  }

  // 9. routes without `records` keep the stock parser: objects, schemas, empty bodies, proto keys
  res = await app.inject({ method: 'POST', url: '/plain', headers: { 'content-type': 'application/json' }, payload: '{"a":1}' })
  assert(res.statusCode === 200 && res.json().echo.a === 1, 'plain route: the stock JSON parser')
  res = await app.inject({ method: 'POST', url: '/plain-schema', headers: { 'content-type': 'application/json' }, payload: '{"n":"x"}' })
  assert(res.statusCode === 400 && /n/.test(res.json().message), 'plain route with a body schema: route validation still runs')
  res = await app.inject({ method: 'POST', url: '/plain', headers: { 'content-type': 'application/json' }, payload: '' })
  assert(res.statusCode === 400 && res.json().code === 'FST_ERR_CTP_EMPTY_JSON_BODY', 'plain route, empty body: FST_ERR_CTP_EMPTY_JSON_BODY')
  res = await app.inject({ method: 'POST', url: '/plain', headers: { 'content-type': 'application/json' }, payload: '{"__proto__":{"x":1}}' })
  assert(res.statusCode === 400, `plain route, __proto__ key: refused as before (${res.statusCode})`)
  res = await app.inject({ method: 'POST', url: '/plain', headers: { 'content-type': 'application/json' }, payload: '{"a":1' })
  assert(res.statusCode === 400 && res.json().code === 'FST_ERR_CTP_INVALID_JSON_BODY', 'plain route, broken JSON: FST_ERR_CTP_INVALID_JSON_BODY')
  res = await app.inject({ method: 'POST', url: '/plain', headers: { 'content-type': 'application/x-ndjson' }, payload: '{"a":1}' })
  assert(res.statusCode === 200 && res.json().echo.a === 1, 'plain route, ndjson content type: one document parsed as JSON')

  // 10. a record schema may refer to a shared schema
  const app2 = fastify()
  app2.addSchema({ $id: 'mail', type: 'string', format: 'email' })
  await app2.register(fastifyAtaStream)
  app2.post('/ref', { config: { records: { type: 'object', properties: { email: { $ref: 'mail#' } }, required: ['email'] } } }, async (req) => ({ got: req.body.length }))
  res = await app2.inject({ method: 'POST', url: '/ref', headers: { 'content-type': 'application/x-ndjson' }, payload: '{"email":"a@b.co"}\n{"email":"nope"}\n' })
  assert(res.statusCode === 400 && /record 1\/email/.test(res.json().message), `shared $ref in a record schema: ${res.json().message}`)

  // 11. abortEarly off by default: a record's errors are all listed
  res = await app.inject({ method: 'POST', url: '/import', headers: { 'content-type': 'application/x-ndjson' }, payload: '{"id":0,"email":"nope"}\n' })
  assert(res.statusCode === 400 && /record 0/.test(res.json().message), 'first record invalid twice over: 400 at record 0')

  await app.close()
  await app2.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })
