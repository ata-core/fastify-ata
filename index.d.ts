import { FastifyPluginCallback, FastifyTypeProvider } from 'fastify'
import { Infer, JSONSchema } from 'ata-validator'

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

declare namespace fastifyAta {
  /**
   * Fastify type provider backed by ata's `Infer<S>`. Use with
   * `Fastify().withTypeProvider<fastifyAta.AtaTypeProvider>()` and author route
   * schemas with `defineSchema(...)` from ata-validator so `request.body`,
   * `request.query`, etc. are typed from the schema with no manual annotation.
   */
  interface AtaTypeProvider extends FastifyTypeProvider {
    validator: this['schema'] extends JSONSchema ? Infer<this['schema']> : unknown
    serializer: this['schema'] extends JSONSchema ? Infer<this['schema']> : unknown
  }
}

declare const fastifyAta: FastifyPluginCallback<FastifyAtaOptions>
export = fastifyAta
