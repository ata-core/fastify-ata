'use strict'

const { Validator } = require('ata-validator')
const { expandMergePatch } = require('./merge-patch')

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
    // Default to Fastify's default AJV behavior: coerce (array mode, so a scalar
    // becomes a single-element array), apply defaults, strip undeclared
    // properties. Honor explicit overrides, preserving the 'array' mode value.
    const coerceTypes = customOptions.coerceTypes !== undefined ? customOptions.coerceTypes : 'array'
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
      // Fastify's ecosystem (error handlers, tests, ajv-errors consumers)
      // asserts the exact ajv error object shape; the rich fields belong to
      // the plugin path, not the default-validator path.
      richErrors: false,
    }

    return function buildValidatorFunction({ schema }) {
      schema = expandMergePatch(schema)
      const validator = new Validator(schema, validatorOpts)
      function validate(data) {
        const result = validator.validate(data)
        if (result.valid) {
          validate.errors = null
          return hasCoercion ? { value: data } : true
        }
        // Plain mutable copies: ajv ecosystem plugins (ajv-i18n, error
        // decorators) assign to error fields, and ata's error objects are
        // frozen.
        const errors = firstErrorOnly ? [result.errors[0]] : result.errors
        validate.errors = errors.map((e) => ({ ...e }))
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
