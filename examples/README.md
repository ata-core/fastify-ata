# TypeBox vs ata, same Fastify route

[`typebox-vs-ata.ts`](./typebox-vs-ata.ts) types one route two ways. Both narrow
`request.body` to a discriminated union with no manual annotation. The only
difference is where the schema comes from.

- **TypeBox** writes the schema in the `Type.*` builder DSL and ships the
  `@sinclair/typebox` runtime with the app.
- **ata** uses plain JSON Schema (the thing you already have from an OpenAPI
  doc, a shared registry, or a config file), with `$ref` reuse and no builder.

Because the ata side is plain JSON Schema, the same schema also compiles to a
standalone validator with **no runtime dependency**. For the discriminated union
in this demo ([`event.schema.json`](./event.schema.json)):

```
event.validator.mjs   10,420 bytes raw, 2,111 bytes gzipped, zero imports
event.validator.d.mts    892 bytes (the inferred type)
```

That compiled-output step is the part TypeBox cannot do: it describes the schema
but leans on a separate validator at runtime.

## Reproduce

```sh
npm install
# type-check both sides (request.body narrows in each handler)
npx tsc --noEmit --strict --esModuleInterop examples/typebox-vs-ata.ts
# compile the schema to a standalone, zero-dependency validator
npx ata compile examples/event.schema.json -o examples/event.validator.mjs
gzip -c examples/event.validator.mjs | wc -c
```
