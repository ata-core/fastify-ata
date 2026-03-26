'use strict'

const { Validator } = require('ata-validator')

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
        // mod is either a function (standalone) or { boolFn, hybridFactory, errFn }
        if (typeof mod === 'function') {
          // Direct function — just wrap for Fastify
          return wrapValidator(mod)
        }
        // Module from toStandalone() — restore via fromStandalone
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
      const standalone = v.toStandalone()

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
      validate.errors = result.errors.map(e => ({
        message: e.message,
        instancePath: e.path || '',
        schemaPath: '',
        keyword: e.code || 'validation',
        params: {},
      }))
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
