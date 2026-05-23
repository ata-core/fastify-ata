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

  assert(validate({ name: 'x', age: 1 }) === true, 'standalone: valid input accepted')

  const ok = validate({ age: 5 })
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
