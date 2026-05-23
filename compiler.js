'use strict'

const { Validator } = require('ata-validator')

// @fastify/ajv-compiler-compatible factory so ata can be installed as
// Fastify's global default validator:
//
//   Fastify({ schemaController: { compilersFactory: { buildValidator: AtaCompiler() } } })
//
// Shape mirrors @fastify/ajv-compiler:
//   AtaCompiler() -> buildCompilerFromPool(externalSchemas, options)
//                 -> buildValidatorFunction({ schema }) -> validate(data)

function AtaCompiler() {
  return function buildCompilerFromPool(externalSchemas, options) {
    const customOptions = (options && options.customOptions) || {}
    // Default to Fastify's default AJV behavior: coerce, apply defaults,
    // strip undeclared properties. Honor explicit overrides.
    const coerceTypes = customOptions.coerceTypes !== undefined ? !!customOptions.coerceTypes : true
    const removeAdditional = customOptions.removeAdditional !== undefined ? !!customOptions.removeAdditional : true
    // Fastify's default AJV runs with allErrors: false, reporting only the
    // first violation. Mirror that unless the caller opts into allErrors. ata's
    // abortEarly returns a stub error, so instead collect fully and expose the
    // first real error to keep its message and rich fields intact.
    const firstErrorOnly = customOptions.allErrors !== true
    const hasCoercion = coerceTypes || removeAdditional

    const validatorOpts = {
      schemas: externalSchemas,
      coerceTypes,
      removeAdditional,
    }

    return function buildValidatorFunction({ schema }) {
      const validator = new Validator(schema, validatorOpts)
      function validate(data) {
        const result = validator.validate(data)
        if (result.valid) {
          validate.errors = null
          return hasCoercion ? { value: data } : true
        }
        validate.errors = firstErrorOnly ? [result.errors[0]] : result.errors
        return false
      }
      validate.errors = null
      return validate
    }
  }
}

module.exports = AtaCompiler
module.exports.AtaCompiler = AtaCompiler
module.exports.default = AtaCompiler
