<p align="center">
  <img src="./assets/fastify-ata.svg" alt="fastify-ata" width="640" />
</p>

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

## TypeScript

Write plain JSON Schema and get typed route handlers, no builder DSL. Add the `AtaTypeProvider` and author schemas with `defineSchema`:

```ts
import Fastify from 'fastify'
import fastifyAta from 'fastify-ata'
import { defineSchema } from 'ata-validator'

const app = Fastify().withTypeProvider<fastifyAta.AtaTypeProvider>()
await app.register(fastifyAta)

app.post('/user', {
  schema: {
    body: defineSchema({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
      required: ['name'],
    }),
  },
}, (req, reply) => {
  req.body.name // string
  req.body.age  // number | undefined
  reply.send({ ok: true })
})
```

`defineSchema` preserves the schema's literal types, so `request.body`, `request.query`, `request.params`, and `request.headers` are inferred from the schema. Same idea as `@fastify/type-provider-typebox`, from plain JSON Schema.

`ata-validator` falls back to a pure-JS engine where the native addon is not available (Cloudflare Workers, browsers, Bun), so fastify-ata runs in those environments too.

### Chainable authoring (TypeBox-style)

If you prefer a chainable builder over JSON Schema literals, `ata-validator/t` emits the same plain JSON Schema under the hood, so route schemas, the type provider, and the AOT path all keep working without an adapter. The migration from TypeBox is one import rename:

```ts
import Fastify from 'fastify'
import fastifyAta from 'fastify-ata'
import { t } from 'ata-validator/t'

const app = Fastify().withTypeProvider<fastifyAta.AtaTypeProvider>()
await app.register(fastifyAta)

const Body = t.object({
  name: t.string({ minLength: 1 }),
  age: t.integer({ minimum: 0 }),
  email: t.optional(t.string({ format: 'email' })),
  role: t.union([t.literal('admin'), t.literal('user')]),
})

app.post('/users', { schema: { body: Body } }, (req, reply) => {
  req.body.name    // string
  req.body.email   // string | undefined
  req.body.role    // 'admin' | 'user'
  reply.send({ ok: true })
})
```

## Options

Defaults mirror Fastify's stock validator: `coerceTypes: 'array'` (path params and querystring values arrive as strings and coerce to the schema types, single-element arrays collapse for querystrings) and `removeAdditional: true` (properties outside the schema are stripped, not rejected). Override either to opt out:

```js
fastify.register(fastifyAta, {
  coerceTypes: false,       // reject "42" for integer fields instead of coercing
  removeAdditional: false,  // 400 on properties outside the schema
  abortEarly: true,         // skip detailed error collection (faster invalid path)
  prettyErrors: true,       // 400 message carries the ATA code + a did-you-mean
})
```

With `prettyErrors`, a failed request returns a compiler-style message instead of the plain ajv text:

```
body must have required property 'name' [ATA7001] (did you mean `name` instead of `nme`?)
```

Off by default to keep the ajv-compatible message shape.

`abortEarly` replaces the error list with a shared stub. Good for public endpoints where only the accept/reject decision reaches the caller. On a 10-property schema the invalid path drops from roughly 15 ns/op to 3.7 ns/op.

## Two ways to plug in

### Plugin (encapsulated)

`fastify.register(fastifyAta)` sets the validator compiler in the context it is registered into. Register it on the root instance and it applies everywhere; register it inside a plugin and only that subtree uses ata, while the rest of the app keeps the default validator. Use this when you want ata for some routes and the default for others, or when you are adding ata to an existing app without touching the server construction.

### Global default (full replacement)

If you want ata to be the validator for the whole server, pass the compiler factory at construction time instead. This is the same `schemaController.compilersFactory.buildValidator` hook that `@fastify/ajv-compiler` and [`joi-compiler`](https://github.com/Eomm/joi-compiler) use, so the default ajv validator is never built.

```js
const Fastify = require('fastify')
const AtaCompiler = require('fastify-ata/compiler')

const app = Fastify({
  schemaController: { compilersFactory: { buildValidator: AtaCompiler() } },
})

app.post('/user', {
  schema: {
    body: {
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
      required: ['name'],
    },
  },
}, (req, reply) => reply.send({ ok: true }))
```

The factory mirrors `@fastify/ajv-compiler`: it defaults to Fastify's own ajv behavior (`coerceTypes: 'array'`, `removeAdditional: true`, first error only) and reads `addSchema` registrations for cross-schema `$ref`. Override through `customOptions`:

```js
buildValidator: AtaCompiler() // defaults match Fastify's ajv
// per-instance overrides are read from ajv.customOptions, e.g.:
const app = Fastify({
  ajv: { customOptions: { coerceTypes: false, allErrors: true } },
  schemaController: { compilersFactory: { buildValidator: AtaCompiler() } },
})
```

Note on memory: this replaces the ajv *validator*, so it is never instantiated. The `ajv` module itself can still be pulled into the process by Fastify's serializer (`fast-json-stringify` uses it to check serialization schemas), independent of which validator you choose. Replacing the validator removes ajv from the request validation path, not necessarily from the module graph.

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

### Fastify pipeline (`bench-realtime.js`, autocannon, 50 routes, 50 connections, 5s)

| | ajv (default) | ata |
|---|---|---|
| Requests/sec | 61,258 | 70,198 |
| Latency, average | 0.06 ms | 0.05 ms |
| Latency, p99 | 1.00 ms | 1.00 ms |

HTTP, routing and `JSON.parse` dominate a request, so the validator moves throughput
by about 15% here and no more. `profile-fastify.mjs` splits one request and finds
`JSON.parse` at 92% of the cost against validation at 7%. Throughput is not the
reason to switch; the numbers below are.

### Where ata-validator moves the needle

Schema compilation at boot, from `bench-startup.js`. Each figure is the median of
nine process-isolated runs with a no-route Fastify baseline subtracted, so what is
left is the cost of compiling the route schemas and nothing else.

| Routes | ajv | ata | delta |
|---|---|---|---|
| 50 | 41.6 ms | 1.4 ms | **30x faster** |
| 100 | 70.0 ms | 4.2 ms | **17x faster** |
| 250 | 142.7 ms | 11.4 ms | **13x faster** |
| 500 | 263.0 ms | 18.8 ms | **14x faster** |
| 1000 | 548.4 ms | 41.2 ms | **13x faster** |

Total boot time, baseline included, is 83.6 ms against 583.9 ms at 1000 routes. Below
about 20 routes the difference is under measurement noise and not worth quoting.

### Against the standalone build step (`bench-standalone-vs.js`)

Fastify's documented route to the fastest startup is
[`@fastify/ajv-compiler` in standalone mode](https://backend.cafe/how-to-unlock-the-fastest-fastify-server-startup):
compile every route schema to a file at build time, load the files at boot. The
table is process start to `app.ready()`, five schema types reused across routes,
median of three runs.

| Routes | ajv default | ajv standalone | ata, no build step | ata precompiled |
|---|---|---|---|---|
| 50 | 62 ms | 40 ms | 43 ms | 37 ms |
| 100 | 77 ms | 45 ms | 47 ms | 40 ms |
| 200 | 111 ms | 55 ms | 50 ms | 41 ms |
| 500 | 182 ms | 81 ms | **59 ms** | 46 ms |

Past about 200 routes, installing ata and doing nothing else boots faster than ajv
with the build step in place: 59 ms against 81 ms at 500 routes. Precompiling with
`fastify-ata/standalone` takes another 20% off, but it is an optimization rather
than the thing that makes the difference. Under 100 routes the four are close
enough that boot time should not decide anything.

| Scenario | ajv | ata | delta |
|---|---|---|---|
| **ReDoS pattern** `^(a+)+$` | 765 ms | 0.3 ms | **immune (RE2)** |

Boot cost is the scenario that matters for Vercel, Fly.io and similar platforms, where
a process starts far more often than a long-running box does. On a box that stays up,
the gap is paid once.

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
- **Draft 2020-12 and Draft 7** - every applicable draft 2020-12 case in the official JSON Schema Test Suite passes with the native engine installed (1190/1190); 99.8% pure JS
- **Fastify's own suite** - 178 of 184 tests pass with ata as the default validator; the remaining six test the default validator's private extension API rather than validation behaviour. See [compat/COMPATIBILITY.md](compat/COMPATIBILITY.md)

## License

MIT
