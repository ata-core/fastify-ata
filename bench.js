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

function serverScript(useAta) {
  return `
'use strict'
const fastify = require('fastify')()
${useAta ? "fastify.register(require('./index'))" : ''}
const schema = ${JSON.stringify(schema)}
fastify.post('/users', { schema }, (req, reply) => {
  reply.send({ ok: true, count: req.body.users.length })
})
fastify.listen({ port: 0 }).then(() => {
  process.send({ port: fastify.server.address().port })
})
`
}

async function bench(label, useAta, payload) {
  const scriptPath = path.join(__dirname, '_bench_server.js')
  writeFileSync(scriptPath, serverScript(useAta))

  const { fork } = require('child_process')
  const child = fork(scriptPath, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
  const port = await new Promise((resolve) => {
    child.on('message', (msg) => resolve(msg.port))
  })

  const escaped = payload.replace(/'/g, "'\\''")
  const result = execSync(
    `npx autocannon -c 10 -d 5 -j http://localhost:${port}/users -m POST -H "content-type: application/json" -b '${escaped}'`,
    { cwd: __dirname, timeout: 30000 }
  ).toString()

  child.kill()
  try { unlinkSync(scriptPath) } catch {}

  const parsed = JSON.parse(result)
  return parsed.requests.average
}

async function main() {
  console.log('\n==============================================')
  console.log('  Fastify POST Validation Benchmark')
  console.log('  10 connections, 5 seconds, real HTTP')
  console.log('==============================================\n')

  for (const count of [1, 10, 50, 100]) {
    const payload = makePayload(count)
    console.log(`--- ${count} users (${(payload.length / 1024).toFixed(1)} KB) ---`)

    const ata = await bench('ata', true, payload)
    const ajv = await bench('ajv', false, payload)

    console.log(`  ata: ${ata.toLocaleString().padStart(10)} req/sec`)
    console.log(`  ajv: ${ajv.toLocaleString().padStart(10)} req/sec`)

    const ratio = ata / ajv
    if (ratio >= 1) console.log(`  >>> ata ${ratio.toFixed(2)}x faster`)
    else console.log(`  >>> ajv ${(1 / ratio).toFixed(2)}x faster`)
    console.log()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
