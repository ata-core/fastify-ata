'use strict'

// fastifyAta.precompiled(): the first start writes a file per route schema,
// the next start reads them and compiles nothing, with the same answers and
// the same coercion as the plugin, and with `new Function` refused.

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const fastify = require('fastify')
const fastifyAta = require('./index')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastify-ata-precompiled-'))
const user = { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 }, age: { type: 'integer', minimum: 0 } }, additionalProperties: false }

async function build (mode) {
  const pre = fastifyAta.precompiled({ dir, mode })
  const app = fastify({ schemaController: pre })
  app.addSchema({ $id: 'tags', type: 'array', items: { type: 'string' } })
  app.post('/users', { schema: { body: user } }, async (req) => ({ got: req.body }))
  app.get('/users/:id', { schema: { params: { type: 'object', properties: { id: { type: 'integer' } } }, querystring: { type: 'object', properties: { tags: { $ref: 'tags#' } } } } }, async (req) => ({ id: req.params.id, type: typeof req.params.id, tags: req.query.tags }))
  await app.ready()
  return { app, pre }
}

async function check (app, label) {
  const ok = await app.inject({ method: 'POST', url: '/users', payload: { name: 'a', age: 3, extra: 1 } })
  assert.strictEqual(ok.statusCode, 200, label + ': valid body')
  assert.deepStrictEqual(ok.json().got, { name: 'a', age: 3 }, label + ': additional property removed')
  const bad = await app.inject({ method: 'POST', url: '/users', payload: { name: '', age: -1 } })
  assert.strictEqual(bad.statusCode, 400, label + ': invalid body')
  assert.match(bad.json().message, /name|minLength/, label + ': the error names the field')
  const p = await app.inject({ method: 'GET', url: '/users/42?tags=a&tags=b' })
  assert.strictEqual(p.statusCode, 200, label + ': params')
  assert.deepStrictEqual(p.json(), { id: 42, type: 'number', tags: ['a', 'b'] }, label + ': param coerced to an integer, querystring array through the shared schema')
  const pb = await app.inject({ method: 'GET', url: '/users/x' })
  assert.strictEqual(pb.statusCode, 400, label + ': a bad param')
}

async function main () {
  // 1. write: files appear, the runtime answers this process.
  const w = await build('write')
  await check(w.app, 'write')
  assert.strictEqual(w.pre.stats.written, 3, 'three route schemas written')
  assert.strictEqual(w.pre.stats.read, 0)
  assert.strictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')).length, 3)
  await w.app.close()

  // 2. read: the files answer, and no `new Function` comes from ata or from
  // the files. Fastify's own router and serializer still generate code, so
  // the constructor is counted by caller, not refused.
  const Orig = globalThis.Function
  const fromValidators = []
  // The caller is the frame after the proxy's trap: ata-validator, a file
  // under `dir`, or this plugin's own files count; Fastify's router does not.
  const own = /node_modules\/ata-validator\/|\/(precompiled|standalone|index)\.js:/
  const tally = () => { const frame = new Error().stack.split('\n')[3] || ''; if (own.test(frame) || frame.includes(dir)) fromValidators.push(frame.trim()) }
  Object.defineProperty(globalThis, 'Function', { value: new Proxy(Orig, { construct (t, a, nt) { tally(); return Reflect.construct(t, a, nt) }, apply (t, th, a) { tally(); return Reflect.apply(t, th, a) } }), configurable: true, writable: true })
  let r
  try {
    r = await build('read')
    await check(r.app, 'read')
  } finally {
    Object.defineProperty(globalThis, 'Function', { value: Orig, configurable: true, writable: true })
  }
  assert.strictEqual(r.pre.stats.read, 3, 'three validators read')
  assert.strictEqual(r.pre.stats.compiled, 0, 'nothing compiled')
  assert.deepStrictEqual(fromValidators, [], 'no new Function from the validators')
  await r.app.close()

  // 3. auto: reads what is there, writes a new route's file.
  const a = await build('auto')
  assert.strictEqual(a.pre.stats.read, 3)
  await a.app.close()
  const a2pre = fastifyAta.precompiled({ dir })
  const a2 = fastify({ schemaController: a2pre })
  a2.post('/other', { schema: { body: { type: 'object', properties: { n: { type: 'number' } } } } }, async () => ({}))
  await a2.ready()
  assert.deepStrictEqual(a2pre.stats, { read: 0, written: 1, compiled: 1 })
  await a2.close()

  // 4. read with a file missing: told, not silently compiled.
  const m = fastify({ schemaController: fastifyAta.precompiled({ dir, mode: 'read' }) })
  m.post('/missing', { schema: { body: { type: 'object', properties: { z: { type: 'string' } } } } }, async () => ({}))
  await assert.rejects(() => m.ready(), /no compiled validator at/)

  // 5. a changed schema or option gets a new file: the key covers both.
  const k1 = fastifyAta.precompiled({ dir, mode: 'read' })
  assert.throws(() => k1.compilersFactory.buildValidator({})({ schema: { ...user, title: 'changed' } }), /no compiled validator/)
  assert.throws(() => fastifyAta.precompiled({ dir, mode: 'read', coerceTypes: false }).compilersFactory.buildValidator({})({ schema: user }), /no compiled validator/)
  assert.throws(() => fastifyAta.precompiled({ dir, mode: 'nope' }), /mode must be/)

  fs.rmSync(dir, { recursive: true, force: true })
  console.log('ok: precompiled validators write, read without new Function, coerce as the plugin does')
}

main().catch((e) => { console.error(e); process.exit(1) })
