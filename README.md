# fastify-ata

Fastify plugin for [ata-validator](https://ata-validator.com) — JSON Schema validation powered by simdjson.

Drop-in replacement for Fastify's default ajv validator. Standard Schema V1 compatible.

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
        age: { type: 'integer', minimum: 0 },
        role: { type: 'string', default: 'user' }
      },
      required: ['name']
    }
  }
}, (req, reply) => {
  // req.body.role === 'user' (default applied)
  reply.send({ ok: true, name: req.body.name })
})

fastify.listen({ port: 3000 })
```

All your existing JSON Schema route definitions work as-is.

## Options

```js
fastify.register(fastifyAta, {
  coerceTypes: true,       // convert "42" → 42 for integer fields
  removeAdditional: true,  // strip properties not in schema
})
```

## Standard Schema V1

ata-validator natively implements [Standard Schema V1](https://github.com/standard-schema/standard-schema) — the emerging standard for TypeScript-first schema libraries.

```js
const { Validator } = require('ata-validator')
const v = new Validator(schema)

// Standard Schema V1 interface
const result = v['~standard'].validate(data)
// { value: data } on success
// { issues: [{ message, path }] } on failure
```

Works with Fastify v5's Standard Schema support, tRPC, TanStack Form, Drizzle ORM.

## What it does

- Registers a custom `validatorCompiler` using ata-validator
- Applies `default` values, `coerceTypes`, `removeAdditional` during validation
- Caches compiled schemas (WeakMap) for reuse across routes
- Returns Fastify-compatible validation errors on invalid requests (400)
- Works with Fastify v4 and v5

## Performance

### Real-world HTTP benchmark (autocannon, 10 connections, 5s)

| Payload | ata | ajv | |
|---|---|---|---|
| 1 user (0.1KB) | 65.7K req/sec | 65.7K req/sec | equal |
| 10 users (0.9KB) | 57.2K | 55.3K | +3% |
| 50 users (4.6KB) | 36.0K | 33.8K | +6% |
| 100 users (9.1KB) | 24.6K | 22.6K | +9% |

### Where ata really shines

| Scenario | ata | ajv | |
|---|---|---|---|
| **Serverless cold start** (50 schemas) | 7.7ms | 96ms | **12.5x faster** |
| **ReDoS protection** (catastrophic pattern) | 0.3ms | 765ms | **immune** |
| **Batch NDJSON** (10K items, multi-core) | 13.4M/sec | 5.1M/sec | **2.6x faster** |
| **validate(obj)** valid (isolated) | 76M ops/sec | 8M ops/sec | **9.5x faster** |
| **validate(obj)** invalid (isolated) | 34M ops/sec | 8M ops/sec | **4.3x faster** |
| **Schema compilation** | 113K ops/sec | 818 ops/sec | **138x faster** |

### Things only ata can do

- **RE2 regex engine** — linear-time guaranteed, immune to ReDoS attacks
- **Multi-core parallel validation** — NDJSON batch at 12.5M items/sec
- **Standard Schema V1** — native support, ajv doesn't have it
- **138x faster compilation** — serverless cold starts, dynamic schemas

## License

MIT
