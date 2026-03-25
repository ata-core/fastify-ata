'use strict'

// Matteo's benchmark: @fastify/ajv-compiler standalone vs ata standalone
// Exactly the approach from https://backend.cafe/how-to-unlock-the-fastest-fastify-server-startup

const { fork } = require('child_process')
const { writeFileSync, mkdirSync, rmSync, existsSync, unlinkSync } = require('fs')
const path = require('path')

function makeRoutes(n) {
  // Realistic: 5 schema types reused across routes (like a real API)
  const bases = [
    { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1 }, email: { type: 'string', format: 'email' }, active: { type: 'boolean' } }, required: ['id', 'name', 'email', 'active'] },
    { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, title: { type: 'string', minLength: 1 }, price: { type: 'number', minimum: 0 }, inStock: { type: 'boolean' } }, required: ['id', 'title', 'price'] },
    { type: 'object', properties: { orderId: { type: 'string' }, userId: { type: 'integer' }, total: { type: 'number', minimum: 0 }, status: { type: 'string' } }, required: ['orderId', 'userId', 'total'] },
    { type: 'object', properties: { query: { type: 'string', minLength: 1 }, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['query'] },
    { type: 'object', properties: { token: { type: 'string', minLength: 10 }, action: { type: 'string' }, timestamp: { type: 'integer' } }, required: ['token', 'action'] },
  ]
  return Array.from({ length: n }, (_, i) => ({
    url: '/route' + i,
    schema: bases[i % bases.length],
  }))
}

// ============================================================
// 1. ajv default (no standalone)
// ============================================================
function ajvDefaultScript(routes) {
  return `
'use strict'
const start = performance.now()
const fastify = require('fastify')()
const routes = ${JSON.stringify(routes)}
routes.forEach(r => {
  fastify.post(r.url, { schema: { body: r.schema } }, (req, reply) => reply.send({ ok: true }))
})
fastify.ready().then(() => {
  process.send({ ms: performance.now() - start })
  process.exit()
})
`
}

// ============================================================
// 2. ajv standalone (blog post approach)
// ============================================================
function ajvStandaloneBuildScript(routes, dir) {
  return `
'use strict'
const fastify = require('fastify')
const fs = require('fs')
const path = require('path')
const { StandaloneValidator } = require('@fastify/ajv-compiler')
const sanitize = require('sanitize-filename')

function generateFileName(routeOpts) {
  return path.join('${dir}', 'gen-' + routeOpts.method + '-' + (routeOpts.httpPart || routeOpts.httpStatus) + '-' + sanitize(routeOpts.url) + '.js')
}

const app = fastify({
  jsonShorthand: false,
  schemaController: {
    compilersFactory: {
      buildValidator: StandaloneValidator({
        readMode: false,
        storeFunction(routeOpts, code) { fs.writeFileSync(generateFileName(routeOpts), code) }
      })
    }
  }
})

const routes = ${JSON.stringify(routes)}
routes.forEach(r => {
  app.post(r.url, { schema: { body: r.schema } }, (req, reply) => reply.send({ ok: true }))
})
app.ready().then(() => { process.send({ done: true }); process.exit() })
`
}

function ajvStandaloneReadScript(routes, dir) {
  return `
'use strict'
const start = performance.now()
const fastify = require('fastify')
const path = require('path')
const { StandaloneValidator } = require('@fastify/ajv-compiler')
const sanitize = require('sanitize-filename')

function generateFileName(routeOpts) {
  return path.join('${dir}', 'gen-' + routeOpts.method + '-' + (routeOpts.httpPart || routeOpts.httpStatus) + '-' + sanitize(routeOpts.url) + '.js')
}

const app = fastify({
  jsonShorthand: false,
  schemaController: {
    compilersFactory: {
      buildValidator: StandaloneValidator({
        readMode: true,
        restoreFunction(routeOpts) { return require(generateFileName(routeOpts)) }
      })
    }
  }
})

const routes = ${JSON.stringify(routes)}
routes.forEach(r => {
  app.post(r.url, { schema: { body: r.schema } }, (req, reply) => reply.send({ ok: true }))
})
app.ready().then(() => {
  process.send({ ms: performance.now() - start })
  process.exit()
})
`
}

// ============================================================
// 3. ata compact standalone
// ============================================================
function ataStandaloneScript(routes, bundlePath) {
  return `
'use strict'
const start = performance.now()
const fastify = require('fastify')()
const fns = require('${bundlePath}')
const routes = ${JSON.stringify(routes)}
const map = new WeakMap()
routes.forEach((r, i) => map.set(r.schema, fns[i]))
fastify.setValidatorCompiler(({ schema }) => {
  const fn = map.get(schema)
  return (data) => {
    const r = fn(data)
    if (r.valid) return { value: data }
    const e = new Error(r.errors.map(e => e.message).join(', '))
    e.statusCode = 400
    e.validation = r.errors
    return { error: e }
  }
})
routes.forEach(r => {
  fastify.post(r.url, { schema: { body: r.schema } }, (req, reply) => reply.send({ ok: true }))
})
fastify.ready().then(() => {
  process.send({ ms: performance.now() - start })
  process.exit()
})
`
}

async function runScript(script, timeout = 15000) {
  const f = path.join(__dirname, '_bench_tmp.js')
  writeFileSync(f, script)
  const ms = await new Promise((resolve) => {
    const c = fork(f, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    c.on('message', m => resolve(m.ms || m.done ? m.ms : -1))
    setTimeout(() => { c.kill(); resolve(-1) }, timeout)
  })
  try { unlinkSync(f) } catch {}
  return ms
}

async function main() {
  // Install sanitize-filename if needed
  try { require('sanitize-filename') } catch {
    require('child_process').execSync('npm install sanitize-filename', { cwd: __dirname, stdio: 'pipe' })
  }

  console.log('\n=======================================================')
  console.log('  Fastify Startup: ajv default vs ajv standalone vs ata')
  console.log('  Measures: process start → app.ready()')
  console.log('  Blog post: backend.cafe/how-to-unlock-the-fastest-fastify-server-startup')
  console.log('=======================================================\n')

  for (const n of [50, 100, 200, 500]) {
    const routes = makeRoutes(n)
    console.log(`--- ${n} routes (5 schema types) ---`)

    // 1. ajv default
    const times1 = []
    for (let r = 0; r < 3; r++) times1.push(await runScript(ajvDefaultScript(routes)))
    times1.sort((a, b) => a - b)
    const ajvDefault = times1[1]

    // 2. ajv standalone — build phase
    const ajvDir = path.resolve(__dirname, '_ajv_standalone')
    mkdirSync(ajvDir, { recursive: true })
    await runScript(ajvStandaloneBuildScript(routes, ajvDir), 30000)

    // 2b. ajv standalone — read phase (benchmark this)
    const times2 = []
    for (let r = 0; r < 3; r++) times2.push(await runScript(ajvStandaloneReadScript(routes, ajvDir)))
    times2.sort((a, b) => a - b)
    const ajvStandalone = times2[1]
    try { rmSync(ajvDir, { recursive: true }) } catch {}

    // 3. ata compact standalone — build phase
    const { Validator } = require('ata-validator')
    const schemas = routes.map(r => r.schema)
    const bundlePath = path.resolve(__dirname, '_ata_bundle.js')
    writeFileSync(bundlePath, Validator.bundleCompact(schemas))

    // 3b. ata standalone — read phase (benchmark this)
    const times3 = []
    for (let r = 0; r < 3; r++) times3.push(await runScript(ataStandaloneScript(routes, bundlePath)))
    times3.sort((a, b) => a - b)
    const ataStandalone = times3[1]
    try { unlinkSync(bundlePath) } catch {}

    console.log(`  ajv default:    ${ajvDefault.toFixed(0)}ms`)
    console.log(`  ajv standalone: ${ajvStandalone >= 0 ? ajvStandalone.toFixed(0) + 'ms' : 'FAILED'}`)
    console.log(`  ata compact:    ${ataStandalone.toFixed(0)}ms`)
    if (ajvStandalone > 0) {
      console.log(`  ata vs ajv standalone: ${(ajvStandalone / ataStandalone).toFixed(1)}x faster`)
    }
    console.log(`  ata vs ajv default:    ${(ajvDefault / ataStandalone).toFixed(1)}x faster`)
    console.log()
  }
}

main().catch(console.error)
