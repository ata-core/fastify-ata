'use strict'
// One server per scenario so the process's peak RSS belongs to that scenario.
// argv: mode = buffered | stream | count
const fastify = require('fastify')
const fastifyAta = require('./index.js')
const fastifyAtaStream = require('./stream.js')
const mode = process.argv[2]
const record = {
  type: 'object',
  properties: { id: { type: 'integer', minimum: 1 }, email: { type: 'string', format: 'email' }, name: { type: 'string', minLength: 1 }, qty: { type: 'integer', minimum: 0 } },
  required: ['id', 'email', 'name', 'qty'],
  additionalProperties: false,
}
async function main () {
  const app = fastify({ bodyLimit: 512 * 1024 * 1024 })
  if (mode === 'buffered') {
    await app.register(fastifyAta)
    app.post('/import', { schema: { body: { type: 'array', items: record } } }, async (req) => ({ got: req.body.length }))
  } else {
    await app.register(fastifyAtaStream)
    app.post('/import', { config: { records: record, collect: mode === 'stream' } }, async (req) => ({ got: Array.isArray(req.body) ? req.body.length : req.body.records }))
  }
  app.get('/mem', async () => ({ maxRSS: process.resourceUsage().maxRSS, rss: process.memoryUsage().rss }))
  await app.listen({ port: 0, host: '127.0.0.1' })
  process.send({ port: app.server.address().port })
}
main()
