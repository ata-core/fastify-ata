'use strict'

// Matteo's scenario: Fastify startup time with N routes
// This is what he cares about most

const { writeFileSync, unlinkSync } = require('fs')
const path = require('path')

function makeRouteSchemas(count) {
  const routes = []
  for (let i = 0; i < count; i++) {
    routes.push({
      path: `/api/v1/resource${i}`,
      schema: {
        body: {
          type: 'object',
          properties: {
            id: { type: 'integer', minimum: 1 },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            email: { type: 'string', format: 'email' },
            [`field_${i}`]: { type: 'string' },
            active: { type: 'boolean' },
          },
          required: ['id', 'name', 'email'],
        },
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    })
  }
  return routes
}

function serverScript(useAta, routeCount) {
  const routes = makeRouteSchemas(routeCount)
  return `
'use strict'
const t0 = process.hrtime.bigint()
const fastify = require('fastify')()
${useAta ? "fastify.register(require('./index'))" : ''}
const routes = ${JSON.stringify(routes)}
for (const r of routes) {
  fastify.post(r.path, { schema: r.schema }, (req, reply) => {
    reply.send({ ok: true })
  })
}
fastify.ready().then(() => {
  const dt = Number(process.hrtime.bigint() - t0) / 1e6
  process.send({ startupMs: dt })
  process.exit(0)
})
`
}

async function measureStartup(useAta, routeCount, runs) {
  const scriptPath = path.join(__dirname, '_startup_bench.js')
  const times = []

  for (let r = 0; r < runs; r++) {
    writeFileSync(scriptPath, serverScript(useAta, routeCount))
    const { fork } = require('child_process')
    const child = fork(scriptPath, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    const ms = await new Promise((resolve, reject) => {
      child.on('message', msg => resolve(msg.startupMs))
      child.on('error', reject)
      setTimeout(() => { child.kill(); reject(new Error('timeout')) }, 10000)
    })
    times.push(ms)
  }

  try { unlinkSync(scriptPath) } catch {}
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length / 2)]
}

async function main() {
  console.log('\n==============================================')
  console.log('  Fastify Startup Benchmark (cold start)')
  console.log('  Median of 5 runs, process-isolated')
  console.log('==============================================\n')

  for (const count of [5, 10, 25, 50, 100]) {
    console.log(`--- ${count} routes (body + querystring schemas) ---`)

    const ata = await measureStartup(true, count, 5)
    const ajv = await measureStartup(false, count, 5)

    console.log(`  ata: ${ata.toFixed(1).padStart(8)} ms`)
    console.log(`  ajv: ${ajv.toFixed(1).padStart(8)} ms`)
    console.log(`  >>> ata ${(ajv / ata).toFixed(1)}x faster startup`)
    console.log()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
