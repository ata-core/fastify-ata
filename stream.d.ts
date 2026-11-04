import { FastifyPluginCallback } from 'fastify'
import { JSONSchema, ValidationError } from 'ata-validator'

interface FastifyAtaStreamOptions {
  /**
   * Content types the record parser takes over. On a route without
   * `config.records` they are parsed by Fastify's stock JSON parser, as before.
   * Default: `['application/x-ndjson', 'application/json']`.
   */
  contentTypes?: string[]
  /** Stop at a record's first error instead of listing all of its errors. */
  abortEarly?: boolean
  /** Forwarded to the stock JSON parser for routes without `config.records`. */
  onProtoPoisoning?: 'error' | 'remove' | 'ignore'
  onConstructorPoisoning?: 'error' | 'remove' | 'ignore'
}

/** The error a refused record answers with: 400, the record's index from zero and its errors. */
interface RecordRefusedError extends Error {
  statusCode: 400
  code: 'FST_ERR_ATA_STREAM_RECORD' | 'FST_ERR_ATA_STREAM_PARSE'
  record: number
  validation: ValidationError[]
  validationContext: 'body'
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * The schema of one record. A route that sets it takes its body as one
     * JSON document per line or as a JSON array, validated record by record as
     * the bytes arrive; the first failure answers 400 before the rest is read.
     */
    records?: JSONSchema
    /** Hand the handler the records as an array (default) or, with false, only `{ records: count }`. */
    collect?: boolean
    /** How the body carries its records; by default the first non-blank character decides. */
    format?: 'ndjson' | 'array' | 'auto'
  }
}

declare const fastifyAtaStream: FastifyPluginCallback<FastifyAtaStreamOptions>

declare namespace fastifyAtaStream {
  export { FastifyAtaStreamOptions, RecordRefusedError }
  export { fastifyAtaStream as default, fastifyAtaStream }
}

export = fastifyAtaStream
