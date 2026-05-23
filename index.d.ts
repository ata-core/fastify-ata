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
  /**
   * Install a schema error formatter that renders compiler-grade messages,
   * including the ATA error code and a did-you-mean suggestion when available.
   * Off by default to preserve AJV-compatible error messages.
   */
  prettyErrors?: boolean
}

declare const fastifyAta: FastifyPluginCallback<FastifyAtaOptions>

export = fastifyAta
