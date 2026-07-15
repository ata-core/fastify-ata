'use strict'

const { Validator } = require('ata-validator')
const { toStandaloneModule } = require('ata-validator/build')

// Fastify schemaController compatible standalone compiler.
// Same API as @fastify/ajv-compiler/standalone — drop-in replacement.
//
// WRITE mode (build phase):
//   const { StandaloneValidator } = require('fastify-ata/standalone')
//   buildValidator: StandaloneValidator({
//     readMode: false,
//     storeFunction(routeOpts, code) { fs.writeFileSync(fileName, code) }
//   })
//
// READ mode (startup):
//   buildValidator: StandaloneValidator({
//     readMode: true,
//     restoreFunction(routeOpts) { return require(fileName) }
//   })

function StandaloneValidator(options = { readMode: true }) {
  if (options.readMode === true && !options.restoreFunction) {
    throw new Error('You must provide a restoreFunction when readMode is true')
  }
  if (options.readMode !== true && !options.storeFunction) {
    throw new Error('You must provide a storeFunction when readMode is false')
  }

  if (options.readMode === true) {
    // READ MODE: load pre-compiled validator from file
    return function wrapper() {
      return function buildValidatorFunction(opts) {
        const mod = options.restoreFunction(opts)
        // mod is a function (standalone), a { validate, isValid } module
        // (toStandaloneModule output), or a legacy { boolFn, hybridFactory,
        // errFn } artifact from the pre-1.0 instance toStandalone().
        if (typeof mod === 'function') {
          return wrapValidator(mod)
        }
        if (typeof mod.validate === 'function') {
          return wrapValidator(mod.validate)
        }
        if (mod.boolFn || mod.hybridFactory) {
          const v = Validator.fromStandalone(mod, opts.schema)
          return wrapValidator((data) => v.validate(data))
        }
        // Fallback: compile fresh
        const v = new Validator(opts.schema)
        return wrapValidator((data) => v.validate(data))
      }
    }
  }

  // WRITE MODE: compile schema, generate standalone code, store to file
  return function wrapper() {
    return function buildValidatorFunction(opts) {
      const v = new Validator(opts.schema)
      // CJS so the stored file works with a plain require() in restoreFunction.
      const standalone = toStandaloneModule(v, { format: 'cjs' })

      if (standalone) {
        options.storeFunction(opts, standalone)
      }

      return wrapValidator((data) => v.validate(data))
    }
  }
}

function wrapValidator(validateFn) {
  // Fastify expects: return true on valid, return false on invalid.
  // On invalid, validate.errors must contain ajv-compatible error objects.
  function validate(data) {
    const result = validateFn(data)
    if (result && result.valid !== undefined) {
      if (result.valid) {
        validate.errors = null
        return true
      }
      validate.errors = result.errors
      return false
    }
    // Boolean result
    if (result) { validate.errors = null; return true }
    validate.errors = [{ message: 'validation failed', instancePath: '', schemaPath: '', keyword: 'validation', params: {} }]
    return false
  }
  validate.errors = null
  return validate
}

module.exports = StandaloneValidator
