# fastify-ata

Fastify plugin for [ata-validator](https://ata-validator.com) — JSON Schema validation powered by simdjson.

Replaces the default ajv validator compiler with ata-validator. Beats ajv on every valid-path benchmark.

## Install

```bash
npm install fastify-ata
```

## Usage

```js
const fastify = require('fastify')()
const fastifyAta = require('fastify-ata')

fastify.register(fastifyAta)

fastify.post('/user', {
  schema: {
    body: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        age: { type: 'integer', minimum: 0 }
      },
      required: ['name']
    }
  }
}, (req, reply) => {
  reply.send({ ok: true, name: req.body.name })
})

fastify.listen({ port: 3000 })
```

That's it. All your existing JSON Schema route definitions work as-is.

## What it does

- Registers a custom `validatorCompiler` using ata-validator
- Caches compiled schemas for reuse across routes
- Returns Fastify-compatible validation errors on invalid requests (400)
- Works with Fastify v4 and v5

## Why

| | ata-validator | ajv |
|---|---|---|
| validate(obj) valid | **1.1x faster** | baseline |
| validate(obj) 100 users | **2.7x faster** | baseline |
| Schema compilation | **151x faster** | baseline |
| Parallel batch (10K) | **5.9x faster** (12.5M items/sec) | 2.1M items/sec |
| Engine | simdjson + V8 codegen + multi-core | JS (single-thread) |
| Spec compliance | 98.5% Draft 2020-12 | ~100% |
| Standard Schema V1 | Yes | No |

> ata uses speculative validation: a V8-optimized JS codegen fast path runs first. Valid data (the common case) never crosses the NAPI boundary.

## License

MIT
