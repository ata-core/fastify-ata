# Examples

Two examples that show ata against TypeBox on the same Fastify route, picked
because they answer the two questions teams ask before migrating: "does the
type provider narrow exactly the same way" and "what does the migration
diff actually look like."

## `typebox-migration.ts` — TypeBox to `ata-validator/t`

If you already author schemas with TypeBox, the migration is two import
renames: `@sinclair/typebox` becomes `ata-validator/t`, `Type` becomes `t`.
Authoring shape stays identical, the type provider keeps inferring
`request.body` exactly the same way, and the runtime moves to ata. The same
schema can then also be precompiled with `ata build` into a standalone,
zero-dependency module, which TypeBox cannot do on its own.

```sh
npm install
npx tsc --noEmit --strict --esModuleInterop --ignoreDeprecations 6.0 examples/typebox-migration.ts
```

The example asserts `Static<typeof TbUser>` and `Infer<typeof AtaUser>`
resolve to the exact same TypeScript type, so the migration is
behaviour-preserving on both the runtime and the type side.

## `typebox-vs-ata.ts` — TypeBox DSL vs plain JSON Schema

The other angle: if you don't want a builder DSL at all, ata accepts plain
JSON Schema directly (the thing you already have from an OpenAPI doc, a
shared registry, or a config file). Both routes in this file narrow
`request.body` to a discriminated union with no manual annotation. The only
difference is where the schema comes from.

```sh
npm install
# type-check both sides
npx tsc --noEmit --strict --esModuleInterop --ignoreDeprecations 6.0 examples/typebox-vs-ata.ts
# compile the schema to a standalone, zero-dependency validator
npx ata compile examples/event.schema.json -o examples/event.validator.mjs
gzip -c examples/event.validator.mjs | wc -c
```

For the discriminated union schema in this demo
([`event.schema.json`](./event.schema.json)):

```
event.validator.mjs   10,420 bytes raw, 2,111 bytes gzipped, zero imports
event.validator.d.mts    892 bytes (the inferred type)
```

That compiled-output step is the part TypeBox cannot do: it describes the
schema but leans on a separate validator at runtime.
