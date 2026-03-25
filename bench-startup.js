'use strict'

const { execSync } = require('child_process')
const { writeFileSync, unlinkSync, mkdirSync, rmSync } = require('fs')
const path = require('path')

// Generate N route schemas
function makeSchemas(n) {
  const schemas = []
  for (let i = 0; i < n; i++) {
    schemas.push({
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1 },
        email: { type: 'string', format: 'email' },
        active: { type: 'boolean' },
        [`field_${i}`]: { type: 'string' },
      },
      required: ['id', 'name', 'email', 'active'],
    })
  }
  return schemas
}

function serverScript(mode, n) {
  const schemas = makeSchemas(n)

  if (mode === 'ajv-normal') {
    return `
'use strict'
const start = performance.now()
const fastify = require('fastify')()
const schemas = ${JSON.stringify(schemas)}
schemas.forEach((s, i) => {
  fastify.post('/route' + i, { schema: { body: s } }, (req, reply) => reply.send({ ok: true }))
})
fastify.ready().then(() => {
  const ms = performance.now() - start
  process.send({ ms })
  process.exit()
})
`
  }

  if (mode === 'ata-normal') {
    return `
'use strict'
const start = performance.now()
const fastify = require('fastify')()
fastify.register(require('./index'))
const schemas = ${JSON.stringify(schemas)}
schemas.forEach((s, i) => {
  fastify.post('/route' + i, { schema: { body: s } }, (req, reply) => reply.send({ ok: true }))
})
fastify.ready().then(() => {
  const ms = performance.now() - start
  process.send({ ms })
  process.exit()
})
`
  }

  if (mode === 'ata-standalone') {
    return `
'use strict'
const start = performance.now()
const fastify = require('fastify')()
const { Validator } = require('ata-validator')
const schemas = ${JSON.stringify(schemas)}
const cache = new WeakMap()
fastify.setValidatorCompiler(({ schema }) => {
  let v = cache.get(schema)
  if (!v) {
    const idx = schemas.indexOf(schema)
    if (idx >= 0) {
      try {
        const mod = require('./standalone/s' + idx + '.js')
        v = Validator.fromStandalone(mod, schema)
      } catch {
        v = new Validator(schema)
      }
    } else {
      v = new Validator(schema)
    }
    cache.set(schema, v)
  }
  return (data) => {
    const r = v.validate(data)
    if (r.valid) return { value: data }
    const err = new Error(r.errors.map(e => e.message).join(', '))
    err.statusCode = 400
    err.validation = r.errors.map(e => ({ message: e.message, instancePath: e.path || '' }))
    return { error: err }
  }
})
schemas.forEach((s, i) => {
  fastify.post('/route' + i, { schema: { body: s } }, (req, reply) => reply.send({ ok: true }))
})
fastify.ready().then(() => {
  const ms = performance.now() - start
  process.send({ ms })
  process.exit()
})
`
  }
}

async function bench(label, mode, n) {
  const scriptPath = path.join(__dirname, '_startup_server.js')
  writeFileSync(scriptPath, serverScript(mode, n))

  // Pre-build standalone files if needed
  if (mode === 'ata-standalone') {
    const { Validator } = require('ata-validator')
    const schemas = makeSchemas(n)
    const dir = path.join(__dirname, 'standalone')
    mkdirSync(dir, { recursive: true })
    schemas.forEach((s, i) => {
      const v = new Validator(s)
      const src = v.toStandalone()
      if (src) writeFileSync(path.join(dir, `s${i}.js`), src)
    })
  }

  const runs = 5
  const times = []
  for (let r = 0; r < runs; r++) {
    const { fork } = require('child_process')
    const ms = await new Promise((resolve, reject) => {
      const child = fork(scriptPath, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
      child.on('message', (msg) => resolve(msg.ms))
      child.on('error', reject)
      setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 10000)
    })
    times.push(ms)
  }

  try { unlinkSync(path.join(__dirname, '_startup_server.js')) } catch {}

  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  console.log(`  ${label.padEnd(30)} ${median.toFixed(1)}ms (median of ${runs})`)
  return median
}

async function main() {
  console.log('\n==============================================')
  console.log('  Fastify Startup Benchmark')
  console.log('  Time from process start to app.ready()')
  console.log('==============================================\n')

  for (const n of [10, 50, 100]) {
    console.log(`--- ${n} routes ---`)
    const ajv = await bench('fastify + ajv (default)', 'ajv-normal', n)
    const ata = await bench('fastify + ata (normal)', 'ata-normal', n)
    const standalone = await bench('fastify + ata (standalone)', 'ata-standalone', n)
    console.log(`  ajv default: ${ajv.toFixed(1)}ms`)
    console.log(`  ata normal:  ${ata.toFixed(1)}ms (${(ajv/ata).toFixed(1)}x vs ajv)`)
    console.log(`  ata standalone: ${standalone.toFixed(1)}ms (${(ajv/standalone).toFixed(1)}x vs ajv)`)
    console.log()
  }

  // Cleanup
  try { rmSync(path.join(__dirname, 'standalone'), { recursive: true }) } catch {}
}

main().catch(console.error)
