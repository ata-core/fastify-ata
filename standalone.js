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
//
// The files are written with the plugin's validator options (coerceTypes
// 'array' and removeAdditional on, as Fastify's own validator; `coerceTypes`,
// `removeAdditional` and `abortEarly` in the options change them), so a
// precompiled route answers as a route through the plugin does, path
// parameters read as integers included. Earlier versions wrote the files
// without them, and a module then rejected `/users/:id` for a string id.
// For one line that does the writing and the reading, see precompiled.js.

function StandaloneValidator(options = { readMode: true }) {
  const validatorOpts = {
    coerceTypes: options.coerceTypes !== undefined ? options.coerceTypes : 'array',
    removeAdditional: options.removeAdditional !== undefined ? !!options.removeAdditional : true,
    abortEarly: options.abortEarly || false,
  }
  const hasCoercion = !!(validatorOpts.coerceTypes || validatorOpts.removeAdditional)
  if (options.readMode === true && !options.restoreFunction) {
    throw new Error('You must provide a restoreFunction when readMode is true')
  }
  if (options.readMode !== true && !options.storeFunction) {
    throw new Error('You must provide a storeFunction when readMode is false')
  }

  if (options.readMode === true) {
    // READ MODE: load pre-compiled validator from file
    return function wrapper(externalSchemas) {
      const shared = externalSchemas ? Object.values(externalSchemas) : []
      return function buildValidatorFunction(opts) {
        const mod = options.restoreFunction(opts)
        // mod is a function (standalone), a { validate, isValid } module
        // (toStandaloneModule output), or a legacy { boolFn, hybridFactory,
        // errFn } artifact from the pre-1.0 instance toStandalone().
        if (typeof mod === 'function') {
          return wrapValidator(mod, hasCoercion)
        }
        if (typeof mod.validate === 'function') {
          return wrapValidator(mod.validate, hasCoercion)
        }
        if (mod.boolFn || mod.hybridFactory) {
          const v = Validator.fromStandalone(mod, opts.schema)
          return wrapValidator((data) => v.validate(data), hasCoercion)
        }
        // Fallback: compile fresh
        const v = new Validator(opts.schema, { ...validatorOpts, schemas: shared })
        return wrapValidator((data) => v.validate(data), hasCoercion)
      }
    }
  }

  // WRITE MODE: compile schema, generate standalone code, store to file
  return function wrapper(externalSchemas) {
    const shared = externalSchemas ? Object.values(externalSchemas) : []
    return function buildValidatorFunction(opts) {
      const v = new Validator(opts.schema, { ...validatorOpts, schemas: shared })
      // CJS so the stored file works with a plain require() in restoreFunction.
      const standalone = toStandaloneModule(v, { format: 'cjs' })

      if (standalone) {
        options.storeFunction(opts, standalone)
      }

      return wrapValidator((data) => v.validate(data), hasCoercion)
    }
  }
}

function wrapValidator(validateFn, hasCoercion) {
  // Fastify expects: return true on valid, return false on invalid, or
  // { value } with the data as the pass left it when it coerces.
  // On invalid, validate.errors must contain ajv-compatible error objects.
  function validate(data) {
    const result = validateFn(data)
    if (result && result.valid !== undefined) {
      if (result.valid) {
        validate.errors = null
        return hasCoercion ? { value: data } : true
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
