import { FastifyPluginAsync } from 'fastify'
import { JSONSchema } from 'ata-validator'

interface FastifyAtaPlansOptions {
  /** The schemas to serve as plans, by the name the path carries (`/plans/<name>`). */
  plans: Record<string, JSONSchema>
  /** The route prefix. Default `/plans`. */
  prefix?: string
  /** Write plans with ata's rich errors, read on the page with `ata-validator/plan-rich`. Default false: plain errors, read with `ata-validator/plan`. */
  richErrors?: boolean
  /** Assert `format` (default true), as the page's validator will. */
  assertFormat?: boolean
  /** Fill defaults (default true), as the page's validator will. */
  useDefaults?: boolean
  /** The `max-age` the route sends. Default 300. */
  maxAge?: number
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The plan registered under a name, or null. */
    ataPlan(name: string): object | null
  }
}

declare const fastifyAtaPlans: FastifyPluginAsync<FastifyAtaPlansOptions>

declare namespace fastifyAtaPlans {
  export { FastifyAtaPlansOptions }
  export { fastifyAtaPlans as default, fastifyAtaPlans }
}

export = fastifyAtaPlans
