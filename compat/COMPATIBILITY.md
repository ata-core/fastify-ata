# Fastify test suite compatibility

fastify-ata can serve as Fastify's global default validator. To measure what that actually means, we run Fastify's own schema and validation test files against ata instead of the default validator, using the preload harness in this directory:

```
cd <fastify checkout>
node --require <fastify-ata>/compat/ata-default-preload.js \
  --test $(ls test/*schema*.test.js test/*valid*.test.js | tr '\n' ' ')
```

The preload swaps the single `require('@fastify/ajv-compiler')` inside Fastify's schema controller for the ata factory in `../compiler.js`. Tests that build their own AJV instance or set a custom `validatorCompiler` bypass the swap and keep using AJV, as they should.

## Current score

**180 of 187 tests pass** (Fastify v5.8.4 checkout, ata-validator 1.0.2, fastify-ata main).

Everything Fastify's suite asserts about validation behavior passes: type checks and coercion (including the `array` coercion mode), defaults, `removeAdditional`, required and enum handling, cross-schema `$ref` through `addSchema`, draft-07 `$id` anchors, `nullable`, `oneOf`/`anyOf` branching, custom error messages via `errorMessage`, `$merge`/`$patch` keywords, fail-fast startup errors for unresolvable references, encapsulation scoping, error shape (exact default error object layout, mutable for plugins like ajv-i18n), the error paths in `validation-error-handling`, and shared-schema `$ref` into `/definitions` across the validator AND the serializer (ata never mutates caller-provided schema objects, so fast-json-stringify sees them untouched).

## The remaining 7, one by one

These tests do not check validation behavior; they check that the validator IS AJV, by exercising AJV's own extension API or internals. Any validator that is not AJV fails them by definition.

| Test | Why it cannot apply |
|---|---|
| Check how many AJV instances are built #1 | Counts AJV instance allocations inside the validator pool. ata has no AJV instances to count. |
| Check how many AJV instances are built #2 - verify validatorPool | Same, via the pool object identity. |
| Ajv plugins array parameter | Passes AJV plugin functions through `ajv: { plugins: [...] }`. ata does not execute AJV plugins; equivalent behavior is configured through ata options. |
| Supports async AJV validation | Requires `$async: true` schemas compiled by AJV's async mode. ata's async story is `validateAsync`/refinements, a different (non-AJV) API. |
| Check all the async AJV validation paths | Same `$async` mechanism, more paths. |
| Check if hooks and attachValidation work with AJV validations | Registers a custom async AJV keyword (`idExists`) via `ajv.customOptions.keywords`, then uses `$async`. Custom-keyword registration is AJV's extension API. |
| should return custom error messages with ajv-errors | Content already matches (ata honors `errorMessage`); only the ORDER of collected errors differs (AJV reports keyword-order, ata reports required-first). Tracked as an ata-core error-ordering decision. |

So of the 7, six are AJV-identity tests and one is a known item on the ata side, tracked.

## Reading the number honestly

The suite contains 187 tests because it grew around AJV; a hypothetical perfect drop-in that is not AJV tops out at 181. ata is at 180 of those 181, with the last one (error ordering) named above. If you find a behavior difference not covered here, that is a bug in fastify-ata or ata: please open an issue.
