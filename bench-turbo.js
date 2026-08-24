'use strict'

const { execSync } = require('child_process')
const { writeFileSync, unlinkSync } = require('fs')
const path = require('path')

const schema = {
  body: {
    type: 'object',
    properties: {
      users: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer', minimum: 1 },
            name: { type: 'string', minLength: 1 },
            email: { type: 'string', format: 'email' },
            age: { type: 'integer', minimum: 0, maximum: 150 },
            active: { type: 'boolean' },
            role: { enum: ['admin', 'user', 'moderator'] },
          },
          required: ['id', 'name', 'email', 'active', 'role'],
        },
      },
      metadata: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['total', 'page'],
      },
    },
    required: ['users', 'metadata'],
  },
}

function makePayload(n) {
  const users = []
  for (let i = 0; i < n; i++) {
    users.push({
      id: i + 1,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      age: 25,
      active: true,
      role: 'user',
    })
  }
  return JSON.stringify({ users, metadata: { total: n, page: 1 } })
}

function serverScript(turbo) {
  return `
'use strict'
const fastify = require('fastify')()
fastify.register(require('./index'), { turbo: ${turbo} })
const schema = ${JSON.stringify(schema)}
fastify.post('/users', { schema }, (req, reply) => {
  reply.send({ ok: true, count: req.body.users.length })
})
fastify.listen({ port: 0 }).then(() => {
  process.send({ port: fastify.server.address().port })
})
`
}

async function bench(label, turbo, payload) {
  const scriptPath = path.join(__dirname, '_bench_turbo_server.js')
  writeFileSync(scriptPath, serverScript(turbo))

  const { fork } = require('child_process')
  const child = fork(scriptPath, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
  const port = await new Promise((resolve) => {
    child.on('message', (msg) => resolve(msg.port))
  })

  const escaped = payload.replace(/'/g, "'\\''")
  const result = execSync(
    `npx autocannon -c 10 -d 5 -j http://localhost:${port}/users -m POST -H "content-type: application/json" -b '${escaped}'`,
    { cwd: __dirname, timeout: 30000 },
  ).toString()

  child.kill()
  try { unlinkSync(scriptPath) } catch {}

  const parsed = JSON.parse(result)
  return parsed.requests.average
}

async function main() {
  console.log('\n==============================================')
  console.log('  Turbo Mode Benchmark: normal vs turbo')
  console.log('  10 connections, 5 seconds, real HTTP')
  console.log('==============================================\n')

  for (const count of [1, 10, 50, 100]) {
    const payload = makePayload(count)
    console.log(`--- ${count} users (${(payload.length / 1024).toFixed(1)} KB) ---`)

    const normal = await bench('normal', false, payload)
    const turbo = await bench('turbo', true, payload)

    console.log(`  normal: ${normal.toLocaleString().padStart(10)} req/sec`)
    console.log(`  turbo:  ${turbo.toLocaleString().padStart(10)} req/sec`)

    const ratio = turbo / normal
    if (ratio >= 1) console.log(`  >>> turbo ${ratio.toFixed(2)}x faster`)
    else console.log(`  >>> normal ${(1 / ratio).toFixed(2)}x faster`)
    console.log()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
