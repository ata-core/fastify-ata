'use strict'

// Tests the @fastify/ajv-compiler-compatible factory so ata can serve as
// Fastify's GLOBAL default validator (not just a per-route compiler).

const Fastify = require('fastify')
const AtaCompiler = require('./compiler')
const { expandMergePatch } = require('./merge-patch')

let pass = 0
let fail = 0

function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS  ${msg}`) }
  else { fail++; console.log(`  FAIL  ${msg}`) }
}

async function run() {
  console.log('\nfastify-ata compiler (global default) Tests\n')

  // Factory shape mirrors @fastify/ajv-compiler: factory() -> build(ext, opts) -> compile({schema}) -> validate
  const factory = AtaCompiler()
  const build = factory({}, { customOptions: {} })
  const validate = build({ schema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } })
  assert(validate({ n: 1 }) === true || (validate({ n: 1 }) && validate({ n: 1 }).value), 'compiler: valid input accepted')
  const bad = validate({})
  assert(bad === false, 'compiler: invalid input rejected')
  // The compiler path is Fastify's default-validator route: errors must be
  // the exact ajv shape (no rich fields) and mutable, because ecosystem
  // plugins like ajv-i18n assign to error.message. Rich errors belong to the
  // plugin path.
  const err0 = validate.errors && validate.errors[0]
  assert(err0 && err0.keyword && err0.message && err0.code === undefined && err0.docUrl === undefined,
    `compiler: ajv-shaped errors (got ${JSON.stringify(err0)})`)
  err0.message = 'mutated'
  assert(err0.message === 'mutated', 'compiler: error objects are mutable')

  // As Fastify's GLOBAL default via schemaController, with cross-schema $ref
  const app = Fastify({
    schemaController: { compilersFactory: { buildValidator: AtaCompiler() } },
  })
  app.addSchema({ $id: 'addr', type: 'object', properties: { city: { type: 'string' } }, required: ['city'] })
  app.post('/u', {
    schema: {
      body: {
        type: 'object',
        properties: { name: { type: 'string' }, address: { $ref: 'addr#' } },
        required: ['name', 'address'],
      },
    },
  }, (req, reply) => reply.send({ ok: true }))
  await app.ready()

  const okRes = await app.inject({ method: 'POST', url: '/u', payload: { name: 'M', address: { city: 'IST' } } })
  assert(okRes.statusCode === 200, `compiler: cross-schema $ref valid -> 200 (got ${okRes.statusCode})`)

  const badRes = await app.inject({ method: 'POST', url: '/u', payload: { name: 'M', address: {} } })
  assert(badRes.statusCode === 400, `compiler: cross-schema $ref invalid -> 400 (got ${badRes.statusCode})`)
  await app.close()

  // coerceTypes default on (matches Fastify default): querystring "5" -> 5
  const app2 = Fastify({
    schemaController: { compilersFactory: { buildValidator: AtaCompiler() } },
  })
  app2.get('/q', {
    schema: { querystring: { type: 'object', properties: { limit: { type: 'integer' } }, required: ['limit'] } },
  }, (req, reply) => reply.send({ limit: req.query.limit, typ: typeof req.query.limit }))
  await app2.ready()
  const qRes = await app2.inject({ method: 'GET', url: '/q?limit=5' })
  assert(qRes.statusCode === 200, `compiler: coerced querystring -> 200 (got ${qRes.statusCode})`)
  assert(JSON.parse(qRes.payload).typ === 'number', `compiler: querystring coerced to number (got ${qRes.payload})`)
  await app2.close()

  // --- $merge / $patch expansion tests ---

  // root $merge: required added via with
  const mergeResult = expandMergePatch({
    $merge: {
      source: { type: 'object', properties: { q: { type: 'string' } } },
      with: { required: ['q'] }
    }
  })
  assert(
    mergeResult.type === 'object' &&
    Array.isArray(mergeResult.required) &&
    mergeResult.required[0] === 'q',
    '$merge: required added via with'
  )

  // root $patch: add op changes a property type
  const patchResult = expandMergePatch({
    $patch: {
      source: { type: 'object', properties: { q: { type: 'string' } } },
      with: [{ op: 'add', path: '/properties/q', value: { type: 'number' } }]
    }
  })
  assert(
    patchResult.properties && patchResult.properties.q && patchResult.properties.q.type === 'number',
    '$patch: add op changes property type'
  )

  // nested $merge inside a larger schema
  const nestedSchema = {
    type: 'object',
    properties: {
      inner: {
        $merge: {
          source: { type: 'object', properties: { n: { type: 'integer' } } },
          with: { required: ['n'] }
        }
      }
    }
  }
  const nestedResult = expandMergePatch(nestedSchema)
  assert(
    nestedResult.properties.inner.required &&
    nestedResult.properties.inner.required[0] === 'n' &&
    nestedResult.properties.inner.type === 'object',
    '$merge nested: expansion works inside properties'
  )

  // null deletes key in $merge
  const nullDeleteResult = expandMergePatch({
    $merge: {
      source: { type: 'object', required: ['x'], properties: { x: { type: 'string' } } },
      with: { required: null }
    }
  })
  assert(
    !('required' in nullDeleteResult),
    '$merge null: null in with deletes the key'
  )

  // unsupported op throws
  let threw = false
  try {
    expandMergePatch({
      $patch: {
        source: { type: 'object' },
        with: [{ op: 'move', from: '/a', path: '/b' }]
      }
    })
  } catch (e) {
    threw = e.message.includes('unsupported op')
  }
  assert(threw, '$patch: unsupported op throws with clear message')

  // remove on non-existent path throws
  let removeMissingThrew = false
  try {
    expandMergePatch({
      $patch: {
        source: { type: 'object', properties: { x: { type: 'string' } } },
        with: [{ op: 'remove', path: '/properties/y' }]
      }
    })
  } catch (e) {
    removeMissingThrew = e.message.includes('cannot remove non-existent path')
  }
  assert(removeMissingThrew, '$patch: remove on non-existent path throws')

  // replace on non-existent path throws
  let replaceMissingThrew = false
  try {
    expandMergePatch({
      $patch: {
        source: { type: 'object', properties: { x: { type: 'string' } } },
        with: [{ op: 'replace', path: '/properties/z', value: { type: 'number' } }]
      }
    })
  } catch (e) {
    replaceMissingThrew = e.message.includes('cannot replace non-existent path')
  }
  assert(replaceMissingThrew, '$patch: replace on non-existent path throws')

  // expansion depth limit: construct deeply nested $merge chain that exceeds limit
  let depthThrew = false
  const buildDeepMerge = (depth) => {
    if (depth === 0) return { type: 'object' }
    return { $merge: { source: buildDeepMerge(depth - 1), with: { properties: { x: { type: 'string' } } } } }
  }
  try {
    expandMergePatch(buildDeepMerge(105))
  } catch (e) {
    depthThrew = e.message.includes('expansion exceeded depth limit')
  }
  assert(depthThrew, '$merge/$patch: expansion depth limit enforced')

  // schema without $merge/$patch passes through unchanged (no copy)
  const plain = { type: 'object', properties: { x: { type: 'string' } } }
  assert(expandMergePatch(plain) === plain, '$merge/$patch: plain schema passes through without copy')

  // $merge integration: compiler accepts expanded schema
  const factory2 = AtaCompiler()
  const build2 = factory2({}, { customOptions: {} })
  const mergeSchema = {
    $merge: {
      source: { type: 'object', properties: { n: { type: 'integer' } } },
      with: { required: ['n'] }
    }
  }
  const validateMerge = build2({ schema: mergeSchema })
  assert(validateMerge({ n: 1 }) !== false, '$merge compiler integration: valid input accepted')
  assert(validateMerge({}) === false, '$merge compiler integration: missing required rejected')

  // --- $ref resolvability checks ---

  // (a) anchor-style local ref that does not exist -> must throw
  {
    const factory3 = AtaCompiler()
    const build3 = factory3({}, { customOptions: {} })
    let threw = false
    let thrownMsg = ''
    try {
      build3({ schema: { type: 'object', properties: { name: { $ref: '#notExist' } } } })
    } catch (e) {
      threw = true
      thrownMsg = e.message
    }
    assert(threw, 'ref-check: #notExist with no externals throws')
    assert(thrownMsg === "can't resolve reference #notExist from id #",
      `ref-check: #notExist message exact (got: ${thrownMsg})`)
  }

  // (b) external ref with no matching external schema -> must throw
  {
    const factory4 = AtaCompiler()
    const build4 = factory4({}, { customOptions: {} })
    let threw = false
    let thrownMsg = ''
    try {
      build4({ schema: { type: 'object', properties: { id: { $ref: 'encapsulation#/properties/id' } } } })
    } catch (e) {
      threw = true
      thrownMsg = e.message
    }
    assert(threw, 'ref-check: encapsulation#/properties/id with no externals throws')
    assert(thrownMsg === "can't resolve reference encapsulation#/properties/id from id #",
      `ref-check: encapsulation message exact (got: ${thrownMsg})`)
  }

  // (c) external ref WITH matching external schema -> must NOT throw
  {
    const factory5 = AtaCompiler()
    const build5 = factory5(
      { encapsulation: { $id: 'encapsulation', type: 'object', properties: { id: { type: 'number' } } } },
      { customOptions: {} }
    )
    let threw = false
    try {
      build5({ schema: { type: 'object', properties: { id: { $ref: 'encapsulation#/properties/id' } } } })
    } catch (e) {
      threw = true
    }
    assert(!threw, 'ref-check: encapsulation#/properties/id with external schema does NOT throw')
  }

  // (d) local JSON-pointer ref -> always accepted even when definitions absent
  {
    const factory6 = AtaCompiler()
    const build6 = factory6({}, { customOptions: {} })
    let threw = false
    try {
      build6({ schema: { type: 'object', properties: { x: { $ref: '#/definitions/x' } } } })
    } catch (e) {
      threw = true
    }
    assert(!threw, 'ref-check: local JSON-pointer #/definitions/x does NOT throw (conservative)')
  }

  // (e) anchor that EXISTS as $id in a local definition -> must NOT throw
  {
    const factory7 = AtaCompiler()
    const build7 = factory7({}, { customOptions: {} })
    let threw = false
    try {
      build7({
        schema: {
          type: 'object',
          definitions: { addr: { $id: '#addr', type: 'string' } },
          properties: { city: { $ref: '#addr' } }
        }
      })
    } catch (e) {
      threw = true
    }
    assert(!threw, 'ref-check: anchor #addr existing as $id in local definitions does NOT throw')
  }

  console.log(`\n${pass}/${pass + fail} tests passed\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((err) => { console.error(err); process.exit(1) })
