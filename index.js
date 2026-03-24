'use strict'

const fp = require('fastify-plugin')
const { Validator } = require('ata-validator')

function fastifyAta(fastify, opts, done) {
  const cache = new WeakMap()
  const validatorOpts = {
    coerceTypes: opts.coerceTypes || false,
    removeAdditional: opts.removeAdditional || false,
  }

  fastify.setValidatorCompiler(({ schema }) => {
    let validator = cache.get(schema)
    if (!validator) {
      validator = new Validator(schema, validatorOpts)
      cache.set(schema, validator)
    }
    return (data) => {
      const result = validator.validate(data)
      if (result.valid) {
        return { value: data }
      }
      const err = new Error(result.errors.map(e => e.message).join(', '))
      err.statusCode = 400
      err.validation = result.errors.map(e => ({
        message: e.message,
        instancePath: e.path || '',
        schemaPath: '',
        keyword: '',
        params: {},
      }))
      return { error: err }
    }
  })

  done()
}

module.exports = fp(fastifyAta, {
  fastify: '>=4.0.0',
  name: 'fastify-ata',
})
