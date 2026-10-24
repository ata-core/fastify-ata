'use strict'

const StandaloneValidator = require('./standalone')

let pass = 0
let fail = 0

function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS  ${msg}`) }
  else { fail++; console.log(`  FAIL  ${msg}`) }
}

const schema = {
  type: 'object',
  properties: { name: { type: 'string' }, age: { type: 'integer' } },
  required: ['name'],
}

function run() {
  console.log('\nfastify-ata standalone error passthrough Tests\n')

  const build = StandaloneValidator({ readMode: false, storeFunction() {} })()
  const validate = build({ schema })

  // Coercion is on, as in the plugin, so a valid document comes back as { value }.
  const accepted = validate({ name: 'x', age: 1 })
  assert(accepted && accepted.value && accepted.value.name === 'x', 'standalone: valid input accepted')
  const coerced = validate({ name: 'x', age: '7' })
  assert(coerced && coerced.value && coerced.value.age === 7, 'standalone: coerces as the plugin does')
  const closed = build({ schema: { ...schema, additionalProperties: false } })({ name: 'x', extra: true })
  assert(closed && closed.value && !('extra' in closed.value), 'standalone: removes additional properties where the schema closes the object, as the plugin does')
  // The written file carries the same pass.
  let stored = null
  const writer = StandaloneValidator({ readMode: false, storeFunction(_, code) { stored = code } })()
  writer({ schema })
  const m = { exports: {} }
  new Function('module', 'exports', stored)(m, m.exports)
  const fromFile = m.exports.validate({ name: 'x', age: '7', extra: true })
  assert(fromFile.valid === true, 'standalone file: a string age is coerced before the check')
  assert(StandaloneValidator({ readMode: false, coerceTypes: false, removeAdditional: false, storeFunction() {} })()({ schema })({ name: 'x', age: 1 }) === true, 'standalone: without coercion the answer is a plain true')

  // `nam`, a typo of the required key, so the error carries a hint.
  const ok = validate({ nam: 'x', age: 5 })
  assert(ok === false, 'standalone: invalid input rejected')

  const e = validate.errors[0]
  assert(e.keyword === 'required', `standalone: keyword is the JSON Schema keyword, not the code (got "${e.keyword}")`)
  assert(e.code === 'ATA7001', `standalone: rich code preserved (got "${e.code}")`)
  assert(e.schemaPath === '#/required', `standalone: schemaPath preserved (got "${e.schemaPath}")`)
  assert(e.params && e.params.missingProperty === 'name', `standalone: params preserved (got ${JSON.stringify(e.params)})`)
  assert(e.suggestion && /did you mean/.test(e.suggestion.text), `standalone: suggestion preserved (got ${JSON.stringify(e.suggestion)})`)

  console.log(`\n${pass}/${pass + fail} tests passed\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run()
