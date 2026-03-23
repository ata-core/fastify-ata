# fastify-ata

Fastify plugin for [ata-validator](https://ata-validator.com) — JSON Schema validation powered by simdjson.

Replaces the default ajv validator compiler with ata-validator for **120x faster schema compilation**.

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
| Schema compilation | **120x faster** | baseline |
| Engine | simdjson + RE2 + codegen | JS |
| Spec compliance | 98.6% Draft 2020-12 | ~100% |
| Standard Schema V1 | Yes | No |

## License

MIT
