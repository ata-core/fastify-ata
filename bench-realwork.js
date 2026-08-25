'use strict'
// How much of the ata-vs-ajv throughput difference survives once a route does
// real work? Echo handlers make the validator look decisive. A handler that
// awaits anything at all does not. This is the benchmark behind the second
// table in the README's throughput section.
const { fork } = require('child_process')
const { writeFileSync, unlinkSync } = require('fs')
const path = require('path')
const autocannon = require('autocannon')

const schema = { type:'object', properties:{
  id:{type:'integer'}, name:{type:'string'}, email:{type:'string'},
  age:{type:'integer',minimum:0}, active:{type:'boolean'}, role:{type:'string',enum:['admin','user']} },
  required:['id','name','email','age','active','role'] }

function server(useAta, workMs, port) {
  return `
'use strict'
const fastify = require('fastify')()
${useAta ? `fastify.register(require(${JSON.stringify(path.resolve(__dirname,'index.js'))}))` : ''}
const schema = ${JSON.stringify(schema)}
const WORK = ${workMs}
fastify.post('/u', { schema: { body: schema } }, async (req, reply) => {
  if (WORK > 0) await new Promise(r => setTimeout(r, WORK))
  return { ok: true }
})
fastify.listen({ port: ${port} }).then(() => process.send({ up: true }))
`
}

function start(src) {
  return new Promise((res) => {
    const f = path.join(__dirname, '_srv_' + Math.random().toString(36).slice(2) + '.js')
    writeFileSync(f, src)
    const child = fork(f, { silent: true })
    child.on('message', () => res({ child, f }))
  })
}

async function bench(port, connections) {
  const r = await autocannon({ url: 'http://127.0.0.1:' + port + '/u', method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, name: 'Ada', email: 'a@e.com', age: 36, active: true, role: 'admin' }),
    connections, duration: 5 })
  return r.requests.average
}

;(async () => {
  console.log('per-request work   ajv req/s    ata req/s   delta')
  let port = 3310
  for (const workMs of [0, 1, 5, 20]) {
    const conns = workMs === 0 ? 50 : 200
    const a = await start(server(false, workMs, port)); const ajv = await bench(port, conns); a.child.kill(); unlinkSync(a.f); port++
    const b = await start(server(true, workMs, port)); const ata = await bench(port, conns); b.child.kill(); unlinkSync(b.f); port++
    const label = workMs === 0 ? 'none (echo)' : workMs + ' ms async'
    console.log(label.padEnd(18), String(Math.round(ajv)).padStart(9), String(Math.round(ata)).padStart(12),
      ('  ' + (((ata - ajv) / ajv) * 100).toFixed(1) + '%').padStart(8))
  }
})()
