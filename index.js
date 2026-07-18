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
  // Defaults mirror Fastify's stock validator configuration (and compiler.js):
  // types are coerced with querystring array support and additional properties
  // are removed. Anything else breaks `/users/:id` on the documented
  // `register(fastifyAta)` path, because path params always arrive as strings.
  const coerceTypes = opts.coerceTypes !== undefined ? opts.coerceTypes : 'array'
  const removeAdditional = opts.removeAdditional !== undefined ? !!opts.removeAdditional : true
  const hasCoercion = !!(coerceTypes || removeAdditional)
  const validatorOpts = {
    coerceTypes,
    removeAdditional,
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
