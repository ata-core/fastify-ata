'use strict'

// Profile validation overhead in Fastify context
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const { Validator } = require('ata-validator')

// Simulate what Fastify does: JSON.parse + validate
const schema = {
  type: 'object',
  properties: {
    users: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', minimum: 1 },
          name: { type: 'string', minLength: 1 },
          email: { type: 'string', format: 'email' },
          age: { type: 'integer', minimum: 0, maximum: 150 },
          active: { type: 'boolean' },
          role: { enum: ['admin', 'user', 'moderator'] },
        },
        required: ['id', 'name', 'email', 'active', 'role'],
      },
    },
    metadata: {
      type: 'object',
      properties: {
        total: { type: 'integer' },
        page: { type: 'integer', minimum: 1 },
      },
      required: ['total', 'page'],
    },
  },
  required: ['users', 'metadata'],
}

function makePayload(n) {
  const users = []
  for (let i = 0; i < n; i++) {
    users.push({ id: i+1, name: `User ${i}`, email: `u${i}@x.com`, age: 25, active: true, role: 'user' })
  }
  return JSON.stringify({ users, metadata: { total: n, page: 1 } })
}

const v = new Validator(schema)
const payloads = [1, 10, 50, 100].map(n => ({ n, json: makePayload(n) }))

// Warmup
for (const p of payloads) {
  for (let i = 0; i < 1000; i++) {
    const obj = JSON.parse(p.json)
    v.validate(obj)
  }
}

console.log('Breakdown: JSON.parse vs validate vs total\n')

const N = 100000
for (const p of payloads) {
  // JSON.parse only
  let t = process.hrtime.bigint()
  for (let i = 0; i < N; i++) JSON.parse(p.json)
  const dtParse = Number(process.hrtime.bigint() - t) / 1e6

  // validate only (pre-parsed)
  const obj = JSON.parse(p.json)
  t = process.hrtime.bigint()
  for (let i = 0; i < N; i++) v.validate(obj)
  const dtValidate = Number(process.hrtime.bigint() - t) / 1e6

  // parse + validate
  t = process.hrtime.bigint()
  for (let i = 0; i < N; i++) { const o = JSON.parse(p.json); v.validate(o) }
  const dtTotal = Number(process.hrtime.bigint() - t) / 1e6

  const parsePct = (dtParse / dtTotal * 100).toFixed(0)
  const valPct = (dtValidate / dtTotal * 100).toFixed(0)

  console.log(`${p.n} users (${(p.json.length/1024).toFixed(1)}KB):`)
  console.log(`  JSON.parse: ${(dtParse/N*1000).toFixed(1)} us (${parsePct}%)`)
  console.log(`  validate:   ${(dtValidate/N*1000).toFixed(1)} us (${valPct}%)`)
  console.log(`  total:      ${(dtTotal/N*1000).toFixed(1)} us`)
  console.log()
}
