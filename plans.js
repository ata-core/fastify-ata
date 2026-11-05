'use strict'

// Plans for the page. A schema the page needs at run time (a form the server
// defines, a schema a CMS serves) goes out as a plan: the server writes it
// once at startup with tablePlan from ata-validator/ir, which does the heavy
// work (references, dialects, normalization), and the page reads it with
// fromPlan from ata-validator/plan, 7 KB gzipped instead of the runtime
// compiler. The page's verdicts, errors and filled defaults are those of
// `new Validator(schema)` on this server, on the same ata-validator version.
//
//   await app.register(require('fastify-ata/plans'), { plans: { signup: signupSchema } })
//   // GET /plans/signup -> the plan, with an ETag
//
// A schema the plan writer does not cover (a $ref to another document, the
// unevaluated keywords, dynamic references, custom keywords or formats) fails
// registration with its name, so the gap is seen at startup and not on the
// page: serve such a schema itself and validate it with `new Validator` there.

const fp = require('fastify-plugin')
const { createHash } = require('node:crypto')

async function fastifyAtaPlans(fastify, opts) {
  const plans = opts.plans
  if (plans === null || typeof plans !== 'object' || Array.isArray(plans)) throw new TypeError('fastify-ata/plans: `plans` is an object of name to schema')
  const prefix = opts.prefix === undefined ? '/plans' : String(opts.prefix).replace(/\/$/, '')
  const writerOpts = { richErrors: !!opts.richErrors, assertFormat: opts.assertFormat !== false, useDefaults: opts.useDefaults !== false }
  const maxAge = opts.maxAge === undefined ? 300 : opts.maxAge
  const { tablePlan } = await import('ata-validator/ir')
  const served = new Map()
  for (const name of Object.keys(plans)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`fastify-ata/plans: "${name}" is not a name a path can carry`)
    const plan = tablePlan(plans[name], writerOpts)
    if (plan === null) throw new Error(`fastify-ata/plans: "${name}" cannot be served as a plan: its schema uses what a plan does not carry (a $ref to another document, the unevaluated keywords, dynamic references, custom keywords or formats). Serve the schema and validate it with new Validator on the page.`)
    const text = JSON.stringify(plan)
    served.set(name, { plan, text, etag: '"' + createHash('sha256').update(text).digest('base64url').slice(0, 27) + '"' })
  }

  fastify.decorate('ataPlan', (name) => { const p = served.get(name); return p === undefined ? null : p.plan })

  fastify.get(prefix + '/:name', (request, reply) => {
    const p = served.get(request.params.name)
    if (p === undefined) { reply.code(404); return { statusCode: 404, error: 'Not Found', message: `no plan named "${request.params.name}"` } }
    reply.header('etag', p.etag)
    reply.header('cache-control', `public, max-age=${maxAge}`)
    if (request.headers['if-none-match'] === p.etag) { reply.code(304).send(); return reply }
    reply.type('application/json; charset=utf-8')
    return p.text
  })
}

module.exports = fp(fastifyAtaPlans, {
  fastify: '>=4.0.0',
  name: 'fastify-ata-plans',
})
module.exports.default = module.exports
module.exports.fastifyAtaPlans = module.exports
