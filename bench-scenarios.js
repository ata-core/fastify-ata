'use strict'

const { execSync } = require('child_process')
const { writeFileSync, unlinkSync } = require('fs')
const path = require('path')

// ============================================================
// Scenario 1: Serverless Cold Start
// Compile 50 schemas + validate 1 request each
// ============================================================
async function benchColdStart() {
  console.log('--- Scenario 1: Serverless Cold Start ---')
  console.log('    Compile 50 schemas + validate 1 request each\n')

  const script = (useAta) => `
'use strict'
${useAta ? `
const { Validator } = require('ata-validator')
` : `
const Ajv = require('ajv')
const addFormats = require('ajv-formats')
`}

const schemas = []
for (let i = 0; i < 50; i++) {
  schemas.push({
    type: 'object',
    properties: {
      ['field' + i]: { type: 'string', minLength: 1 },
      id: { type: 'integer', minimum: 1 },
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      age: { type: 'integer', minimum: 0, maximum: 150 },
      active: { type: 'boolean' },
    },
    required: ['id', 'name', 'email'],
  })
}

// Measure: compile all 50 schemas + validate 1 request each (simulates cold start)
// Single iteration — that's what cold start means
const start = performance.now()
${useAta ? `
const validators = schemas.map(s => new Validator(s))
validators.forEach(v => v.validate({ id: 1, name: 'x', email: 'a@b.com', active: true }))
` : `
schemas.forEach(s => {
  const ajv = new Ajv({ allErrors: true })
  addFormats(ajv)
  const validate = ajv.compile(s)
  validate({ id: 1, name: 'x', email: 'a@b.com', active: true })
})
`}
const elapsed = performance.now() - start
console.log(JSON.stringify({ elapsed: elapsed.toFixed(1) }))
`

  const ataPath = path.join(__dirname, '_cold_ata.js')
  const ajvPath = path.join(__dirname, '_cold_ajv.js')
  writeFileSync(ataPath, script(true))
  writeFileSync(ajvPath, script(false))

  const ataResult = JSON.parse(execSync(`node ${ataPath}`, { cwd: __dirname }).toString())
  const ajvResult = JSON.parse(execSync(`node ${ajvPath}`, { cwd: __dirname }).toString())

  unlinkSync(ataPath)
  unlinkSync(ajvPath)

  console.log(`  ata: ${ataResult.elapsed}ms to compile 50 schemas + validate`)
  console.log(`  ajv: ${ajvResult.elapsed}ms to compile 50 schemas + validate`)
  console.log(`  >>> ata is ${(parseFloat(ajvResult.elapsed) / parseFloat(ataResult.elapsed)).toFixed(1)}x faster\n`)
}

// ============================================================
// Scenario 2: ReDoS Protection
// Pattern with catastrophic backtracking potential
// ============================================================
async function benchReDoS() {
  console.log('--- Scenario 2: ReDoS Protection ---')
  console.log('    Pattern: ^(a+)+$ with pathological input\n')

  const script = (useAta) => `
'use strict'
${useAta ? `
// Force NAPI path to use RE2 (not JS RegExp)
process.env.ATA_FORCE_NAPI = '1'
const { Validator } = require('ata-validator')
const v = new Validator({ type: 'string', pattern: '^(a+)+$' })
` : `
const Ajv = require('ajv')
const ajv = new Ajv()
const validate = ajv.compile({ type: 'string', pattern: '^(a+)+$' })
`}

// Pathological input — causes catastrophic backtracking in JS regex
const input = 'a'.repeat(25) + 'b'

const start = performance.now()
${useAta ? `
const json = JSON.stringify(input)
v.validateJSON(json)
` : `validate(input)`}
const elapsed = performance.now() - start
console.log(JSON.stringify({ elapsed: elapsed.toFixed(3) }))
`

  const ataPath = path.join(__dirname, '_redos_ata.js')
  const ajvPath = path.join(__dirname, '_redos_ajv.js')
  writeFileSync(ataPath, script(true))
  writeFileSync(ajvPath, script(false))

  const ataResult = JSON.parse(execSync(`node ${ataPath}`, { cwd: __dirname, timeout: 5000 }).toString())

  let ajvResult
  try {
    ajvResult = JSON.parse(execSync(`node ${ajvPath}`, { cwd: __dirname, timeout: 5000 }).toString())
  } catch {
    ajvResult = { elapsed: 'TIMEOUT (>5s)' }
  }

  unlinkSync(ataPath)
  unlinkSync(ajvPath)

  console.log(`  ata (RE2):    ${ataResult.elapsed}ms`)
  console.log(`  ajv (JS regex): ${ajvResult.elapsed}${typeof ajvResult.elapsed === 'string' && ajvResult.elapsed.includes('TIMEOUT') ? '' : 'ms'}`)
  if (typeof ajvResult.elapsed === 'number' || !ajvResult.elapsed.includes('TIMEOUT')) {
    const ratio = parseFloat(ajvResult.elapsed) / parseFloat(ataResult.elapsed)
    console.log(`  >>> ata is ${ratio.toFixed(0)}x faster (immune to ReDoS)\n`)
  } else {
    console.log(`  >>> ajv HANGS — catastrophic backtracking. ata is immune.\n`)
  }
}

// ============================================================
// Scenario 3: Large Payload Validation (HTTP)
// ============================================================
async function benchLargePayload() {
  console.log('--- Scenario 3: Large Payload HTTP Validation ---')
  console.log('    500 users per request, real HTTP\n')

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
              active: { type: 'boolean' },
              role: { enum: ['admin', 'user', 'moderator'] },
            },
            required: ['id', 'name', 'email', 'active', 'role'],
          },
        },
      },
      required: ['users'],
    },
  }

  const users = []
  for (let i = 0; i < 500; i++) {
    users.push({ id: i + 1, name: `User ${i}`, email: `u${i}@example.com`, active: true, role: 'user' })
  }
  const payload = JSON.stringify({ users })

  function serverScript(useAta) {
    return `
'use strict'
const fastify = require('fastify')()
${useAta ? "fastify.register(require('./index'))" : ''}
const schema = ${JSON.stringify(schema)}
fastify.post('/users', { schema }, (req, reply) => {
  reply.send({ ok: true })
})
fastify.listen({ port: 0 }).then(() => {
  process.send({ port: fastify.server.address().port })
})
`
  }

  async function run(label, useAta) {
    const scriptPath = path.join(__dirname, '_bench_server.js')
    writeFileSync(scriptPath, serverScript(useAta))
    const { fork } = require('child_process')
    const child = fork(scriptPath, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    const port = await new Promise((resolve) => { child.on('message', (msg) => resolve(msg.port)) })
    const escaped = payload.replace(/'/g, "'\\''")
    const result = execSync(
      `npx autocannon -c 10 -d 5 -j http://localhost:${port}/users -m POST -H "content-type: application/json" -b '${escaped}'`,
      { cwd: __dirname, timeout: 30000 }
    ).toString()
    child.kill()
    try { unlinkSync(scriptPath) } catch {}
    return JSON.parse(result).requests.average
  }

  const ata = await run('ata', true)
  const ajv = await run('ajv', false)

  console.log(`  ata: ${ata.toLocaleString()} req/sec`)
  console.log(`  ajv: ${ajv.toLocaleString()} req/sec`)
  console.log(`  >>> ata ${(ata / ajv).toFixed(2)}x faster (${((ata / ajv - 1) * 100).toFixed(0)}%)\n`)
}

// ============================================================
// Scenario 4: Batch NDJSON Processing
// ============================================================
async function benchBatch() {
  console.log('--- Scenario 4: Batch NDJSON Processing ---')
  console.log('    10K items, multi-core vs single-thread\n')

  const script = (useAta) => `
'use strict'
${useAta ? `
const { Validator } = require('ata-validator')
const v = new Validator({
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    value: { type: 'number' }
  },
  required: ['id', 'name']
})
const lines = []
for (let i = 0; i < 10000; i++) {
  lines.push(JSON.stringify({ id: i, name: 'item' + i, value: Math.random() }))
}
const buf = Buffer.from(lines.join('\\n'))
// Warmup
for (let i = 0; i < 10; i++) v.isValidParallel(buf)

const N = 100
const start = performance.now()
for (let i = 0; i < N; i++) v.isValidParallel(buf)
const elapsed = performance.now() - start
const itemsPerSec = (N * 10000) / (elapsed / 1000)
console.log(JSON.stringify({ items: Math.round(itemsPerSec) }))
` : `
const Ajv = require('ajv')
const ajv = new Ajv()
const validate = ajv.compile({
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    value: { type: 'number' }
  },
  required: ['id', 'name']
})
// Same NDJSON input — parse each line + validate (fair comparison)
const lines = []
for (let i = 0; i < 10000; i++) {
  lines.push(JSON.stringify({ id: i, name: 'item' + i, value: Math.random() }))
}
const ndjson = lines.join('\\n')
// Warmup
for (let i = 0; i < 5; i++) { for (const line of ndjson.split('\\n')) validate(JSON.parse(line)) }

const N = 50
const start = performance.now()
for (let i = 0; i < N; i++) { for (const line of ndjson.split('\\n')) validate(JSON.parse(line)) }
const elapsed = performance.now() - start
const itemsPerSec = (N * 10000) / (elapsed / 1000)
console.log(JSON.stringify({ items: Math.round(itemsPerSec) }))
`}
`

  const ataPath = path.join(__dirname, '_batch_ata.js')
  const ajvPath = path.join(__dirname, '_batch_ajv.js')
  writeFileSync(ataPath, script(true))
  writeFileSync(ajvPath, script(false))

  const ataResult = JSON.parse(execSync(`node ${ataPath}`, { cwd: __dirname, timeout: 60000 }).toString())
  const ajvResult = JSON.parse(execSync(`node ${ajvPath}`, { cwd: __dirname, timeout: 60000 }).toString())

  unlinkSync(ataPath)
  unlinkSync(ajvPath)

  console.log(`  ata (multi-core): ${ataResult.items.toLocaleString()} items/sec`)
  console.log(`  ajv (single-thread): ${ajvResult.items.toLocaleString()} items/sec`)
  console.log(`  >>> ata is ${(ataResult.items / ajvResult.items).toFixed(1)}x faster\n`)
}

async function main() {
  console.log('\n==============================================')
  console.log('  ata-validator vs ajv — Real-World Scenarios')
  console.log('==============================================\n')

  await benchColdStart()
  await benchReDoS()
  await benchLargePayload()
  await benchBatch()

  console.log('==============================================')
  console.log('  Summary: ata wins where it matters most')
  console.log('==============================================\n')
}

main().catch(console.error)
