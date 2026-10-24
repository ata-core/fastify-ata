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

interface PrecompiledOptions {
  /** Where the compiled validators are written and read. Default `.ata`. */
  dir?: string
  /** `'auto'` reads what is there and writes what is not; `'write'` compiles every route; `'read'` never compiles. ATA_PRECOMPILE in the environment sets it too. */
  mode?: 'auto' | 'read' | 'write'
  coerceTypes?: boolean | 'array'
  removeAdditional?: boolean
  abortEarly?: boolean
}

interface Precompiled {
  compilersFactory: { buildValidator: (externalSchemas?: Record<string, unknown>) => (routeSchema: { schema: unknown }) => ((data: unknown) => boolean | { value: unknown }) & { errors: unknown[] | null } }
  /** How many route validators were read from a file, written, and compiled by the runtime in this process. */
  stats: { read: number, written: number, compiled: number }
  dir: string
  mode: 'auto' | 'read' | 'write'
}

declare const fastifyAta: FastifyPluginCallback<FastifyAtaOptions> & {
  /** Route validators compiled ahead of time: `fastify({ schemaController: fastifyAta.precompiled({ dir: './.ata' }) })`. */
  precompiled: (options?: PrecompiledOptions) => Precompiled
}
export = fastifyAta
