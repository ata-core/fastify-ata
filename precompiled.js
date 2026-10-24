'use strict'

// Route validators compiled ahead of time, in one line:
//
//   const app = fastify({ schemaController: fastifyAta.precompiled({ dir: './.ata' }) })
//
// Each route schema gets a file under `dir`, named by a hash of the schema,
// the validator options and the ata-validator version that wrote it. At
// startup a route whose file is there loads it: no schema is compiled, and
// nothing goes through `new Function`, which is what a build with Bun's
// ahead-of-time compiler or a run under
// `--disallow-code-generation-from-strings` needs. A route whose file is
// missing is compiled by the runtime and its file written, so the next start
// reads it. `mode` narrows that:
//
//   'auto'   (default) read what is there, write what is not
//   'write'  compile every route and write its file, for a build step
//   'read'   only read; a missing file is an error, for production
//
// ATA_PRECOMPILE in the environment sets the mode too (`ATA_PRECOMPILE=write
// node app.js` as a build step, `ATA_PRECOMPILE=read` in production).
//
// The files are written with the same options the plugin validates with
// (coerceTypes 'array' and removeAdditional on, as Fastify's own validator),
// and the data goes through the same pass before the check, so a route that
// takes `/users/:id` reads the same integer either way. Fastify's response
// serializer (fast-json-stringify) and router are not touched by this: they
// generate their code at startup as before.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Validator } = require('ata-validator')
const { toStandaloneModule } = require('ata-validator/build')
const ATA_VERSION = require('ata-validator/package.json').version
const { expandMergePatch } = require('./merge-patch')

const MODES = new Set(['auto', 'read', 'write'])
const warned = new Set()
function warnOnce (message) {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
}

function precompiled (options = {}) {
  const dir = path.resolve(options.dir || '.ata')
  const mode = options.mode || process.env.ATA_PRECOMPILE || 'auto'
  if (!MODES.has(mode)) throw new Error(`fastify-ata precompiled: mode must be 'auto', 'read' or 'write', got ${JSON.stringify(mode)}`)
  const validatorOpts = {
    coerceTypes: options.coerceTypes !== undefined ? options.coerceTypes : 'array',
    removeAdditional: options.removeAdditional !== undefined ? !!options.removeAdditional : true,
    abortEarly: options.abortEarly || false,
  }
  const hasCoercion = !!(validatorOpts.coerceTypes || validatorOpts.removeAdditional)
  const optionsKey = JSON.stringify(validatorOpts)
  const stats = { read: 0, written: 0, compiled: 0 }
  // One validator per file in this process: Fastify compiles a GET route's
  // schemas again for the HEAD route it adds, and two routes may share a
  // schema.
  const built = new Map()

  function fileFor (schema, externalSchemas) {
    const key = crypto.createHash('sha256')
      .update(ATA_VERSION).update('\0').update(optionsKey).update('\0')
      .update(JSON.stringify(schema)).update('\0').update(JSON.stringify(externalSchemas))
      .digest('hex').slice(0, 24)
    return path.join(dir, key + '.cjs')
  }

  // Fastify's compilersFactory.buildValidator(externalSchemas, serverOptions):
  // the schemas added with fastify.addSchema, keyed by $id, and the server's
  // validator options, which ata does not read (they are ajv's).
  function buildValidator (externalSchemas) {
    const shared = externalSchemas ? Object.values(externalSchemas) : []
    return function validatorCompiler ({ schema }) {
      schema = expandMergePatch(schema)
      const file = fileFor(schema, shared)
      let fn = built.get(file)
      if (fn !== undefined) {
        // built already
      } else if (mode !== 'write' && fs.existsSync(file)) {
        fn = require(file).validate
        stats.read++
      } else {
        if (mode === 'read') throw new Error(`fastify-ata precompiled: no compiled validator at ${file}; run the app once with ATA_PRECOMPILE=write, or use mode 'auto'`)
        const v = new Validator(schema, { ...validatorOpts, schemas: shared })
        let code = toStandaloneModule(v, { format: 'cjs' })
        // Before ata-validator 1.60.0 a module left coerceTypes and
        // removeAdditional out; such a file would answer differently from
        // the runtime, so it is not written and this route stays on the
        // runtime.
        if (code && hasCoercion && !/function _ataPre\(|_ataPre\(data\)/.test(code)) {
          warnOnce('fastify-ata precompiled: this ata-validator writes modules without coerceTypes and removeAdditional (1.60.0 carries them); routes are validated by the runtime and no files are written')
          code = null
        }
        if (code) {
          fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(file + '.tmp', code)
          fs.renameSync(file + '.tmp', file)
          stats.written++
        }
        fn = (data) => v.validate(data)
        stats.compiled++
      }
      built.set(file, fn)
      const validate = (data) => {
        const result = fn(data)
        if (result.valid) {
          validate.errors = null
          return hasCoercion ? { value: data } : true
        }
        validate.errors = result.errors
        return false
      }
      validate.errors = null
      return validate
    }
  }

  return { compilersFactory: { buildValidator }, stats, dir, mode }
}

module.exports = precompiled
