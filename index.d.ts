import { FastifyPluginCallback } from 'fastify'

interface FastifyAtaOptions {
  /** Convert "42" -> 42 for integer fields, etc. */
  coerceTypes?: boolean
  /** Strip properties that are not declared in the schema. */
  removeAdditional?: boolean
  /**
   * Skip detailed error collection on validation failure. Returns a shared
   * stub error object instead. Useful for high-throughput route guards that
   * only care about reject/accept.
   */
  abortEarly?: boolean
}

declare const fastifyAta: FastifyPluginCallback<FastifyAtaOptions>

export = fastifyAta
