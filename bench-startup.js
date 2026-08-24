'use strict'

// Fastify startup cost, split into the part that is Fastify booting and the
// part that is compiling route schemas.
//
// Total boot time hides the interesting number: a bare Fastify instance costs
// tens of milliseconds before any schema is involved, so comparing totals
// understates the difference between validators. Subtracting a no-schema
// baseline leaves the schema compilation cost on its own.
//
// TypeBox is deliberately not in the comparison. It builds schemas, it does not
// compile them; under Fastify a TypeBox schema is still compiled by whichever
// validator is installed, so it has no separate compile cost to measure.

const { writeFileSync, unlinkSync } = require('fs')
const { fork } = require('child_process')
const path = require('path')

const ROUTE_COUNTS = [0, 10, 50, 100, 250, 500, 1000]
const RUNS = 9

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
  const register = useAta
    ? `fastify.register(require(${JSON.stringify(path.join(__dirname, 'index.js'))}))`
    : ''
  return `
'use strict'
const t0 = process.hrtime.bigint()
const fastify = require('fastify')()
${register}
const routes = ${JSON.stringify(routes)}
for (const r of routes) {
  fastify.post(r.path, { schema: r.schema }, (req, reply) => reply.send({ ok: true }))
}
fastify.ready().then(() => {
  process.send({ startupMs: Number(process.hrtime.bigint() - t0) / 1e6 })
  process.exit(0)
})
`
}

async function measure(useAta, routeCount, runs) {
  const scriptPath = path.join(
    __dirname,
    `_startup_bench_${useAta ? 'ata' : 'ajv'}_${routeCount}.js`,
  )
  writeFileSync(scriptPath, serverScript(useAta, routeCount))
  const times = []

  for (let r = 0; r < runs; r++) {
    const child = fork(scriptPath, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    const ms = await new Promise((resolve, reject) => {
      child.on('message', (msg) => resolve(msg.startupMs))
      child.on('error', reject)
      setTimeout(() => {
        child.kill()
        reject(new Error('timeout'))
      }, 30000)
    })
    times.push(ms)
  }

  try {
    unlinkSync(scriptPath)
  } catch {}
  times.sort((a, b) => a - b)
  return {
    median: times[Math.floor(times.length / 2)],
    min: times[0],
    max: times[times.length - 1],
  }
}

const fmt = (n) => n.toFixed(1).padStart(7)

async function main() {
  console.log(`\nFastify startup, median of ${RUNS} process-isolated runs`)
  console.log(`node ${process.version}\n`)

  const baseline = { ata: null, ajv: null }
  const rows = []

  for (const count of ROUTE_COUNTS) {
    const ata = await measure(true, count, RUNS)
    const ajv = await measure(false, count, RUNS)

    if (count === 0) {
      baseline.ata = ata.median
      baseline.ajv = ajv.median
      console.log('Baseline, no routes and no schemas:')
      console.log(`  with ata plugin ${fmt(ata.median)} ms   (${fmt(ata.min)} to ${fmt(ata.max)})`)
      console.log(`  stock fastify   ${fmt(ajv.median)} ms   (${fmt(ajv.min)} to ${fmt(ajv.max)})`)
      console.log('\nSchema compilation cost, baseline subtracted:\n')
      console.log('  routes        ata        ajv     ratio')
      console.log('  ------------------------------------------')
      continue
    }

    const ataCost = ata.median - baseline.ata
    const ajvCost = ajv.median - baseline.ajv
    rows.push({ count, ataCost, ajvCost, ataTotal: ata.median, ajvTotal: ajv.median })
    console.log(
      `  ${String(count).padStart(5)}  ${fmt(ataCost)} ms ${fmt(ajvCost)} ms   ${(ajvCost / ataCost).toFixed(1)}x`,
    )
  }

  console.log('\nTotal boot time for reference:\n')
  console.log('  routes        ata        ajv')
  console.log('  ------------------------------')
  for (const r of rows) {
    console.log(`  ${String(r.count).padStart(5)}  ${fmt(r.ataTotal)} ms ${fmt(r.ajvTotal)} ms`)
  }
  console.log()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
