import { FastifyPluginCallback } from 'fastify'

interface FastifyAtaOptions {
  coerceTypes?: boolean
  removeAdditional?: boolean
  /**
   * Enable turbo mode: overrides the JSON content-type parser to receive
   * the raw Buffer and uses simdjson-backed validateJSON for validation
   * instead of V8's JSON.parse path. Incompatible with coerceTypes.
   */
  turbo?: boolean
}

declare const fastifyAta: FastifyPluginCallback<FastifyAtaOptions>

export = fastifyAta
