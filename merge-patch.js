'use strict'

// Structural pre-processor: expand $merge (RFC 7386) and $patch (RFC 6902 subset)
// keywords before handing the schema to ata-validator. Fastify passes schemas
// containing these keywords when ajv-merge-patch is listed in ajv.plugins; we
// handle them here so ata never sees them.
//
// Rules:
//   $merge: { source, with }  -> JSON Merge Patch (RFC 7386): W applied to S
//   $patch: { source, with }  -> RFC 6902 JSON Patch (ops: add, replace, remove only)
//
// Expansion is recursive: keywords may be nested anywhere; results may contain
// further keywords. Never mutates the input.

function hasMergePatch(schema) {
  if (!schema || typeof schema !== 'object') return false
  if (Array.isArray(schema)) return schema.some(hasMergePatch)
  if ('$merge' in schema || '$patch' in schema) return true
  return Object.values(schema).some(hasMergePatch)
}

// RFC 7386 JSON Merge Patch: apply patch W onto target S.
// Objects merge recursively; null in W deletes the key; arrays/scalars replace.
function applyMergePatch(source, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch
  }
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    source = {}
  }
  const result = Object.assign({}, source)
  for (const key of Object.keys(patch)) {
    if (patch[key] === null) {
      delete result[key]
    } else {
      result[key] = applyMergePatch(result[key], patch[key])
    }
  }
  return result
}

// JSON Pointer resolution with ~0/~1 unescaping (RFC 6901).
function resolvePointer(obj, pointer) {
  if (pointer === '') return { obj, key: null, parent: null }
  const parts = pointer.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))
  let parent = null
  let current = obj
  let lastKey = null
  for (const part of parts) {
    parent = current
    lastKey = part
    if (current == null || typeof current !== 'object') {
      throw new Error(`$patch: cannot traverse into non-object at /${part}`)
    }
    current = current[part]
  }
  return { parent, key: lastKey, value: current }
}

// RFC 6902 JSON Patch: apply array of ops to document. Supported: add, replace, remove.
function applyJsonPatch(source, ops) {
  // Deep-clone so ops can mutate freely without touching input.
  let doc = JSON.parse(JSON.stringify(source == null ? {} : source))
  for (const op of ops) {
    const { op: opName, path, value } = op
    if (opName === 'add' || opName === 'replace') {
      if (path === '') {
        doc = value
        continue
      }
      const { parent, key } = resolvePointer(doc, path)
      if (parent == null) throw new Error(`$patch: invalid path "${path}"`)
      if (opName === 'replace' && !(key in parent)) {
        throw new Error(`$patch: cannot replace non-existent path "${path}"`)
      }
      parent[key] = value
    } else if (opName === 'remove') {
      if (path === '') throw new Error('$patch: cannot remove root')
      const { parent, key } = resolvePointer(doc, path)
      if (parent == null) throw new Error(`$patch: invalid path "${path}"`)
      if (!(key in parent)) {
        throw new Error(`$patch: cannot remove non-existent path "${path}"`)
      }
      delete parent[key]
    } else {
      throw new Error(`$patch: unsupported op "${opName}" (only add/replace/remove supported)`)
    }
  }
  return doc
}

// Recursively expand $merge/$patch in schema. Returns a new object; never mutates.
function expand(schema, depth = 0) {
  if (depth > 100) {
    throw new Error('$merge/$patch: expansion exceeded depth limit (circular?)')
  }
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(s => expand(s, depth))

  if ('$merge' in schema) {
    const source = expand(schema.$merge.source, depth + 1)
    const patch = expand(schema.$merge.with, depth + 1)
    return expand(applyMergePatch(source, patch), depth + 1)
  }

  if ('$patch' in schema) {
    const source = expand(schema.$patch.source, depth + 1)
    const ops = schema.$patch.with
    return expand(applyJsonPatch(source, ops), depth + 1)
  }

  const result = {}
  for (const key of Object.keys(schema)) {
    result[key] = expand(schema[key], depth)
  }
  return result
}

function expandMergePatch(schema) {
  if (!hasMergePatch(schema)) return schema
  return expand(schema)
}

module.exports = { expandMergePatch }
