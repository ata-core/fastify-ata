'use strict'

// Record bodies validated as they arrive. A route that declares
// `config: { records: schema }` takes its body as one JSON document per line
// or as a JSON array, checks each record against the schema the moment it is
// complete, and answers 400 at the first one that fails, before the rest of
// the body is read. The handler receives the records as an array, or only
// their count with `config: { records: schema, collect: false }`, for a body
// that must never be held in memory at once. Every other route keeps the
// stock JSON parser, buffered as it always was.

const fp = require('fastify-plugin')
const { Validator } = require('ata-validator')
const { streamValidator, PARSE_KEYWORD } = require('ata-validator/stream')
const { errorCodes } = require('fastify')

const { FST_ERR_CTP_BODY_TOO_LARGE, FST_ERR_CTP_INVALID_CONTENT_LENGTH } = errorCodes

const DEFAULT_TYPES = ['application/x-ndjson', 'application/json']
const kRefused = Symbol('fastify-ata-stream.refused')

function recordError(failure) {
  const first = failure.errors[0]
  const parse = first !== undefined && first.keyword === PARSE_KEYWORD
  const where = first === undefined ? '' : (first.instancePath || '')
  const what = first === undefined ? 'is invalid' : first.message
  const err = new Error(parse
    ? `body record ${failure.record} ${what}`
    : `body record ${failure.record}${where} ${what}`)
  err.statusCode = 400
  err.code = parse ? 'FST_ERR_ATA_STREAM_PARSE' : 'FST_ERR_ATA_STREAM_RECORD'
  err.record = failure.record
  err.validation = failure.errors
  err.validationContext = 'body'
  return err
}

function fastifyAtaStream(fastify, opts, done) {
  const types = opts.contentTypes || DEFAULT_TYPES
  const validatorOpts = { abortEarly: opts.abortEarly || false }
  const jsonParser = fastify.getDefaultJsonParser(
    opts.onProtoPoisoning || fastify.initialConfig.onProtoPoisoning || 'error',
    opts.onConstructorPoisoning || fastify.initialConfig.onConstructorPoisoning || 'error')
  const cache = new WeakMap()

  function validatorFor(schema) {
    let v = cache.get(schema)
    if (v === undefined) {
      v = new Validator(schema, { ...validatorOpts, schemas: fastify.getSchemas() })
      cache.set(schema, v)
    }
    return v
  }

  // The stock parser, reached the way Fastify's own buffering reaches it:
  // the content-length check first, the limit on the bytes as they come,
  // the length check at the end, then the string to the JSON parser.
  function buffered(request, payload, limit, next) {
    const contentLength = Number(request.headers['content-length'])
    if (contentLength > limit) return next(new FST_ERR_CTP_BODY_TOO_LARGE())
    let received = 0
    let body = ''
    payload.setEncoding('utf8')
    const stop = () => {
      payload.removeListener('data', onData)
      payload.removeListener('end', onEnd)
      payload.removeListener('error', onEnd)
    }
    function onData(chunk) {
      received += Buffer.byteLength(chunk)
      if (received > limit) { stop(); return next(new FST_ERR_CTP_BODY_TOO_LARGE()) }
      body += chunk
    }
    function onEnd(err) {
      stop()
      if (err != null) {
        if (!(typeof err.statusCode === 'number' && err.statusCode >= 400)) err.statusCode = 400
        return next(err)
      }
      if (!Number.isNaN(contentLength) && received !== contentLength) return next(new FST_ERR_CTP_INVALID_CONTENT_LENGTH())
      jsonParser(request, body, next)
    }
    payload.on('data', onData)
    payload.on('end', onEnd)
    payload.on('error', onEnd)
    payload.resume()
  }

  function streamed(request, payload, limit, config, next) {
    const contentLength = Number(request.headers['content-length'])
    if (contentLength > limit) return next(new FST_ERR_CTP_BODY_TOO_LARGE())
    const collect = config.collect !== false
    const records = collect ? [] : null
    const rs = streamValidator(validatorFor(config.records), {
      format: config.format || 'auto',
      onRecord: collect ? (r) => { records.push(r) } : undefined,
    })
    let received = 0
    const stop = () => {
      payload.removeListener('data', onData)
      payload.removeListener('end', onEnd)
      payload.removeListener('error', onEnd)
    }
    // A body refused part-way is not read further. The request stream is
    // paused, not destroyed: destroying it destroys the socket under the
    // reply Fastify is about to write, and the client sees a reset instead
    // of the 400. The reply goes out with `Connection: close`, and once it
    // has, the onResponse hook closes the socket. Draining a large bad body
    // to keep the connection alive would cost exactly the bytes this parser
    // exists to avoid.
    const refuse = (err) => { stop(); payload.pause(); request[kRefused] = true; next(err) }
    function onData(chunk) {
      received += chunk.length
      if (received > limit) return refuse(new FST_ERR_CTP_BODY_TOO_LARGE())
      const failure = rs.push(chunk)
      if (failure !== null) refuse(recordError(failure))
    }
    function onEnd(err) {
      stop()
      if (err != null) {
        if (!(typeof err.statusCode === 'number' && err.statusCode >= 400)) err.statusCode = 400
        return next(err)
      }
      if (!Number.isNaN(contentLength) && received !== contentLength) return next(new FST_ERR_CTP_INVALID_CONTENT_LENGTH())
      const result = rs.end()
      if (!result.valid) return next(recordError(result.errors[0]))
      next(null, collect ? records : { records: result.records })
    }
    payload.on('data', onData)
    payload.on('end', onEnd)
    payload.on('error', onEnd)
    payload.resume()
  }

  fastify.addHook('onSend', (request, reply, body, next) => {
    if (request[kRefused] === true) reply.header('connection', 'close')
    next()
  })
  fastify.addHook('onResponse', (request, reply, next) => {
    if (request[kRefused] === true) {
      const socket = request.raw.socket
      if (socket && !socket.destroyed) socket.destroy()
    }
    next()
  })

  for (const type of types) {
    if (fastify.hasContentTypeParser(type)) fastify.removeContentTypeParser(type)
    fastify.addContentTypeParser(type, (request, payload, next) => {
      const limit = request.routeOptions.bodyLimit || fastify.initialConfig.bodyLimit
      const config = request.routeOptions.config
      if (config === undefined || config.records === undefined) return buffered(request, payload, limit, next)
      streamed(request, payload, limit, config, next)
    })
  }

  done()
}

module.exports = fp(fastifyAtaStream, {
  fastify: '>=4.0.0',
  name: 'fastify-ata-stream',
})
module.exports.default = module.exports
module.exports.fastifyAtaStream = module.exports
