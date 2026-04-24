# fastify-ata

Fastify plugin for [ata-validator](https://ata-validator.com) - JSON Schema validation powered by simdjson.

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
  coerceTypes: true,       // convert "42" -> 42 for integer fields
  removeAdditional: true,  // strip properties not in schema
  abortEarly: true,        // skip detailed error collection (faster invalid path)
})
```

`abortEarly` replaces the error list with a shared stub. Good for public endpoints where only the accept/reject decision reaches the caller. On a 10-property schema the invalid path drops from roughly 15 ns/op to 3.7 ns/op.

## Standalone Mode (Pre-compiled)

Drop-in replacement for `@fastify/ajv-compiler/standalone`. Same API.

```js
const StandaloneValidator = require('fastify-ata/standalone')

// Build phase (once) - compile schemas to JS files
const app = fastify({
  schemaController: { compilersFactory: {
    buildValidator: StandaloneValidator({
      readMode: false,
      storeFunction(routeOpts, code) {
        fs.writeFileSync(generateFileName(routeOpts), code)
      }
    })
  }}
})

// Read phase (every startup) - load pre-compiled, near-zero compile time
const app = fastify({
  schemaController: { compilersFactory: {
    buildValidator: StandaloneValidator({
      readMode: true,
      restoreFunction(routeOpts) {
        return require(generateFileName(routeOpts))
      }
    })
  }}
})
```

## Standard Schema V1

ata-validator natively implements [Standard Schema V1](https://github.com/standard-schema/standard-schema) - the emerging standard for TypeScript-first schema libraries.

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

All numbers below are reproducible on M4 Pro / Node 25 with the benchmarks in this repo and in `ata-validator/benchmark`. Run-to-run noise is roughly +/- 5% at these scales.

### Fastify pipeline (autocannon, 10 connections, pipelining 10)

| Payload | ajv (default) | ata | delta |
|---|---|---|---|
| valid (10 fields) | ~70,000 req/s | ~70,500 req/s | tied |
| invalid (10 fields) | ~51,000 req/s | ~52,500 req/s | +3% |
| invalid (abortEarly) | ~51,000 req/s | ~52,800 req/s | +3.5% |

HTTP + JSON.parse + routing dominate the pipeline, so validator choice is small on throughput. The real difference is elsewhere.

### Where ata-validator moves the needle

| Scenario | ajv | ata | delta |
|---|---|---|---|
| **Serverless cold start** (10 routes, first request) | 12.4 ms | 0.5 ms | **24x faster** |
| **Startup** (200 routes) | 7.0 ms | 2.4 ms | **2.9x faster** |
| **Invalid validation** (with abortEarly) | ~15 ns/op | 3.7 ns/op | **4x faster** |
| **ReDoS pattern** `^(a+)+$` | 765 ms | 0.3 ms | **immune (RE2)** |

Serverless cold start is the scenario that matters for Vercel, Cloudflare Workers, Fly.io and similar platforms. On a long-running box the gap closes, so classic servers will not see a throughput jump.

### Build-time compile (optional)

For browser / edge deployments, ata ships an `ata compile` CLI that turns a JSON Schema into a self-contained `.mjs` plus TypeScript declarations.

```bash
npx ata compile schemas/user.json -o src/user.validator.mjs --name User
```

A 10-field schema produces:

| Variant | Raw | Gzipped |
|---|---|---|
| ata runtime bundle | 117 KB | 27 KB |
| `ata compile` standard | 4.9 KB | **1.2 KB** |
| `ata compile --abort-early` | 1.3 KB | **0.6 KB** |

Generated file has zero runtime dependency on `ata-validator`. `isValid` is emitted as a TypeScript type predicate, so consumers get narrowing out of the box.

### Features worth calling out

- **RE2 regex** - linear-time guaranteed, immune to catastrophic backtracking
- **simdjson** - SIMD-accelerated JSON parsing for buffer-input paths
- **Multi-core** - `countValid(ndjsonBuf)` validates many messages in one native call
- **Standard Schema V1** - native support, works with Fastify v5, tRPC, TanStack Form, Drizzle
- **Draft 2020-12 and Draft 7** - 98.5% compliance on the official JSON Schema Test Suite

## License

MIT
