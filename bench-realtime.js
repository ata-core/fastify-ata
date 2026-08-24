'use strict'

// Real-time Fastify simulation: actual HTTP requests with autocannon
// Shows: startup time + request throughput + latency

const { writeFileSync, unlinkSync } = require('fs')
const { fork, execSync } = require('child_process')
const path = require('path')

const ROUTES = 50
const DURATION = 5 // seconds
const CONNECTIONS = 50

function makeRoutes(count) {
  return Array.from({ length: count }, (_, i) => ({
    path: `/api/v1/resource${i}`,
    schema: {
      body: {
        type: 'object',
        properties: {
          id: { type: 'integer', minimum: 1 },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: 'string', format: 'email' },
          age: { type: 'integer', minimum: 0, maximum: 150 },
          active: { type: 'boolean' },
          role: { enum: ['admin', 'user', 'moderator'] },
        },
        required: ['id', 'name', 'email', 'active', 'role'],
      },
    },
  }))
}

const routes = makeRoutes(ROUTES)
const payload = JSON.stringify({
  id: 42, name: 'Mert', email: 'mert@example.com',
  age: 26, active: true, role: 'admin'
})

function serverScript(useAta) {
  return `
'use strict'
const t0 = process.hrtime.bigint()
const fastify = require('fastify')()
${useAta ? "fastify.register(require('./index'))" : ''}
const routes = ${JSON.stringify(routes)}
for (const r of routes) {
  fastify.post(r.path, { schema: r.schema }, (req, reply) => {
    reply.send({ ok: true, id: req.body.id })
  })
}
fastify.listen({ port: 0 }).then(() => {
  const startupMs = Number(process.hrtime.bigint() - t0) / 1e6
  const port = fastify.server.address().port
  process.send({ port, startupMs })
})
`
}

async function runTest(label, useAta) {
  const scriptPath = path.join(__dirname, '_realtime_server.js')
  writeFileSync(scriptPath, serverScript(useAta))

  const child = fork(scriptPath, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
  const { port, startupMs } = await new Promise(resolve => {
    child.on('message', msg => resolve(msg))
  })

  // Pick a random route for each request
  const targetRoute = routes[Math.floor(Math.random() * routes.length)].path
  const escaped = payload.replace(/'/g, "'\\''")

  let result
  try {
    const raw = execSync(
      `npx autocannon -c ${CONNECTIONS} -d ${DURATION} -j http://localhost:${port}${targetRoute} -m POST -H "content-type: application/json" -b '${escaped}'`,
      { cwd: __dirname, timeout: 30000 }
    ).toString()
    result = JSON.parse(raw)
  } catch (e) {
    child.kill()
    try { unlinkSync(scriptPath) } catch {}
    return null
  }

  child.kill()
  try { unlinkSync(scriptPath) } catch {}

  return {
    label,
    startupMs,
    reqPerSec: result.requests.average,
    latencyAvg: result.latency.average,
    latencyP99: result.latency.p99,
    throughputMB: (result.throughput.average / 1024 / 1024).toFixed(1),
    errors: result.errors,
    timeouts: result.timeouts,
  }
}

async function main() {
  console.log('\n' + '='.repeat(60))
  console.log('  Real-Time Fastify Simulation')
  console.log(`  ${ROUTES} routes, ${CONNECTIONS} connections, ${DURATION}s duration`)
  console.log('  POST with 6-field validated body')
  console.log('='.repeat(60) + '\n')

  const ata = await runTest('fastify-ata', true)
  const ajv = await runTest('fastify (ajv)', false)

  if (!ata || !ajv) { console.log('Benchmark failed'); return }

  console.log('                    fastify-ata     fastify (ajv)')
  console.log('  ─────────────────────────────────────────────────')
  console.log(`  Startup           ${ata.startupMs.toFixed(1).padStart(8)} ms     ${ajv.startupMs.toFixed(1).padStart(8)} ms`)
  console.log(`  Requests/sec      ${ata.reqPerSec.toLocaleString().padStart(8)}         ${ajv.reqPerSec.toLocaleString().padStart(8)}`)
  console.log(`  Latency (avg)     ${ata.latencyAvg.toFixed(2).padStart(8)} ms     ${ajv.latencyAvg.toFixed(2).padStart(8)} ms`)
  console.log(`  Latency (p99)     ${ata.latencyP99.toFixed(2).padStart(8)} ms     ${ajv.latencyP99.toFixed(2).padStart(8)} ms`)
  console.log(`  Throughput        ${ata.throughputMB.padStart(8)} MB/s    ${ajv.throughputMB.padStart(8)} MB/s`)
  console.log(`  Errors            ${String(ata.errors).padStart(8)}         ${String(ajv.errors).padStart(8)}`)
  console.log(`  Timeouts          ${String(ata.timeouts).padStart(8)}         ${String(ajv.timeouts).padStart(8)}`)
  console.log()

  const startupRatio = ajv.startupMs / ata.startupMs
  const rpsRatio = ata.reqPerSec / ajv.reqPerSec
  console.log(`  Startup: ata ${startupRatio.toFixed(1)}x faster`)
  console.log(`  Throughput: ata ${rpsRatio.toFixed(2)}x ${rpsRatio >= 1 ? 'faster' : 'slower'}`)
  console.log()
}

main().catch(err => { console.error(err); process.exit(1) })
