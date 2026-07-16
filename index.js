'use strict'

const fp = require('fastify-plugin')
const { Validator } = require('ata-validator')
const { expandMergePatch } = require('./merge-patch')

function prettyFormat(errors, dataVar) {
  const message = errors.map((e) => {
    let line = `${dataVar}${e.instancePath || ''} ${e.message}`
    if (e.code) line += ` [${e.code}]`
    if (e.suggestion && e.suggestion.text) line += ` (${e.suggestion.text})`
    return line
  }).join(', ')
  const err = new Error(message)
  err.statusCode = 400
  return err
}

function fastifyAta(fastify, opts, done) {
  const cache = new WeakMap()
  const hasCoercion = !!(opts.coerceTypes || opts.removeAdditional)
  const validatorOpts = {
    coerceTypes: opts.coerceTypes || false,
    removeAdditional: opts.removeAdditional || false,
    abortEarly: opts.abortEarly || false,
  }

  if (opts.prettyErrors) {
    fastify.setSchemaErrorFormatter(prettyFormat)
  }

  fastify.setValidatorCompiler(({ schema }) => {
    let validator = cache.get(schema)
    if (!validator) {
      schema = expandMergePatch(schema)
      // Pass schemas registered via `fastify.addSchema` so cross-schema `$ref`
      // (e.g. `{ $ref: 'shared#' }`) resolves. Compilers run at ready() time,
      // after every addSchema, so getSchemas() returns the full bucket.
      validator = new Validator(schema, { ...validatorOpts, schemas: fastify.getSchemas() })
      cache.set(schema, validator)
    }
    const validate = (data) => {
      const result = validator.validate(data)
      if (result.valid) {
        return hasCoercion ? { value: data } : true
      }
      validate.errors = result.errors
      return false
    }
    validate.errors = null
    return validate
  })

  done()
}

module.exports = fp(fastifyAta, {
  fastify: '>=4.0.0',
  name: 'fastify-ata',
})
