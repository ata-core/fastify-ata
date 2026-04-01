'use strict'

const fp = require('fastify-plugin')
const { Validator } = require('ata-validator')

function fastifyAta(fastify, opts, done) {
  const cache = new WeakMap()
  const hasCoercion = !!(opts.coerceTypes || opts.removeAdditional)
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
