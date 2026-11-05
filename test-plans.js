'use strict'

const fastify = require('fastify')
const { Validator } = require('ata-validator')
const fastifyAtaPlans = require('./plans')

let pass = 0
let fail = 0

function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS  ${msg}`) }
  else { fail++; console.log(`  FAIL  ${msg}`) }
}

const signup = {
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    name: { type: 'string', minLength: 2, maxLength: 50 },
    age: { type: 'integer', minimum: 13, maximum: 120, default: 18 },
    plan: { type: 'string', enum: ['free', 'pro'] },
    terms: { const: true },
  },
  required: ['email', 'name', 'terms'],
  additionalProperties: false,
}
const order = { type: 'object', properties: { items: { type: 'array', minItems: 1, items: { type: 'object', properties: { sku: { type: 'string', pattern: '^[A-Z]{3}-[0-9]{4}$' }, qty: { type: 'integer', minimum: 1 } }, required: ['sku', 'qty'] } } }, required: ['items'] }
const dynamic = { $id: 'https://example.com/tree', type: 'object', properties: { children: { type: 'array', items: { $dynamicRef: '#node' } } }, $defs: { node: { $dynamicAnchor: 'node', type: 'object' } } }

async function run() {
  console.log('\nfastify-ata/plans Tests\n')
  const { fromPlan } = await import('ata-validator/plan')
  const app = fastify()
  await app.register(fastifyAtaPlans, { plans: { signup, order } })

  // 1. the plan is served as JSON a page can read
  let res = await app.inject({ method: 'GET', url: '/plans/signup' })
  assert(res.statusCode === 200 && res.headers['content-type'].startsWith('application/json'), 'GET /plans/signup: 200 JSON')
  const plan = res.json()
  assert(plan.v === 1 && Array.isArray(plan.uses) && plan.uses.includes('tProps'), `the plan names its handlers (${plan.uses.filter((u) => u.startsWith('t')).join(' ')})`)

  // 2. the page's answers are the server's
  const page = await fromPlan(plan)
  const server = new Validator(signup, { richErrors: false })
  const docs = [{ email: 'ada@example.com', name: 'Ada', terms: true, plan: 'pro' }, { email: 'nope', name: 'A', terms: false }, { email: 'ada@example.com', name: 'Ada', terms: true, plan: 'gold', extra: 1 }, {}, 5]
  let same = 0
  for (const d of docs) {
    const a = structuredClone(d); const b = structuredClone(d)
    const ra = page.validate(a); const rb = server.validate(b)
    const sa = JSON.stringify([ra.valid, a, (ra.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message])])
    const sb = JSON.stringify([rb.valid, b, (rb.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message])])
    if (sa === sb) same++; else console.log('    differ:', JSON.stringify(d), '\n      page  ', sa, '\n      server', sb)
  }
  assert(same === docs.length, `page and server agree on ${same} of ${docs.length} documents, defaults filled alike`)

  // 3. caching: an ETag, and 304 when the page already has it
  assert(typeof res.headers.etag === 'string' && /max-age=300/.test(res.headers['cache-control']), 'ETag and cache-control on the plan')
  res = await app.inject({ method: 'GET', url: '/plans/signup', headers: { 'if-none-match': res.headers.etag } })
  assert(res.statusCode === 304, 'If-None-Match with the ETag: 304')

  // 4. an unknown name is 404; the decorator answers the plan object
  res = await app.inject({ method: 'GET', url: '/plans/nothing' })
  assert(res.statusCode === 404, 'unknown name: 404')
  assert(app.ataPlan('order') !== null && app.ataPlan('order').v === 1 && app.ataPlan('nothing') === null, 'fastify.ataPlan(name) gives the plan or null')

  // 5. a schema a plan cannot carry fails registration by name
  const app2 = fastify()
  let err = null
  try { await app2.register(fastifyAtaPlans, { plans: { tree: dynamic } }) } catch (e) { err = e }
  assert(err !== null && /"tree" cannot be served as a plan/.test(err.message), `a dynamic reference refuses registration: ${err && err.message.slice(0, 60)}`)

  // 6. a schema with branches: carried from ata-validator 1.64.0 on, refused
  //    by name on an earlier version rather than served wrong
  const branching = { type: 'object', properties: { contact: { oneOf: [{ type: 'string', format: 'email' }, { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] }] } }, required: ['contact'] }
  const app4 = fastify()
  let err4 = null
  try { await app4.register(fastifyAtaPlans, { plans: { branching } }) } catch (e) { err4 = e }
  if (err4 === null) {
    const p4 = await fromPlan((await app4.inject({ method: 'GET', url: '/plans/branching' })).json())
    const s4 = new Validator(branching, { richErrors: false })
    const ok = [{ contact: 'a@b.co' }, { contact: { phone: '1' } }, { contact: 'nope' }, { contact: 5 }].every((d) => p4.validate(structuredClone(d)).valid === s4.validate(structuredClone(d)).valid)
    assert(ok, `a oneOf plan on ata-validator ${require('ata-validator/package.json').version}: page and server agree`)
  } else {
    assert(/"branching" cannot be served as a plan/.test(err4.message), `a oneOf plan on ata-validator ${require('ata-validator/package.json').version}: refused by name`)
  }
  await app4.close()

  // 7. prefix and rich errors are options
  const app3 = fastify()
  await app3.register(fastifyAtaPlans, { plans: { signup }, prefix: '/forms/', richErrors: true })
  res = await app3.inject({ method: 'GET', url: '/forms/signup' })
  assert(res.statusCode === 200 && res.json().rich === true, 'prefix /forms and a rich plan')

  await app.close(); await app2.close(); await app3.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })
