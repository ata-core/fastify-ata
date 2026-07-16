'use strict'

// Conservative compile-time $ref resolvability check.
// Only throws on clearly-unresolvable refs; when in doubt, stays silent.
// Message format matches ajv: "can't resolve reference <ref> from id #"

/**
 * Collect all $ref string values from a schema (recursive).
 * @param {object} schema
 * @param {string[]} refs
 */
function collectRefs(schema, refs) {
  if (!schema || typeof schema !== 'object') return
  if (Array.isArray(schema)) {
    for (const item of schema) collectRefs(item, refs)
    return
  }
  if (typeof schema.$ref === 'string') refs.push(schema.$ref)
  for (const key of Object.keys(schema)) {
    if (key === '$ref') continue
    collectRefs(schema[key], refs)
  }
}

/**
 * Collect all $id and $anchor string values from a schema (recursive).
 * @param {object} schema
 * @param {Set<string>} ids
 */
function collectIds(schema, ids) {
  if (!schema || typeof schema !== 'object') return
  if (Array.isArray(schema)) {
    for (const item of schema) collectIds(item, ids)
    return
  }
  if (typeof schema.$id === 'string') ids.add(schema.$id)
  if (typeof schema.$anchor === 'string') ids.add(schema.$anchor)
  for (const key of Object.keys(schema)) {
    if (key === '$id' || key === '$anchor') continue
    collectIds(schema[key], ids)
  }
}

/**
 * Trailing-slash-insensitive identifier comparison. Per RFC 3986
 * normalization, 'http://x.test/' and 'http://x.test' identify the same
 * resource and the default resolver accepts either spelling; comparing
 * literally would produce false positives. This only ADDS acceptance.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function idMatches(a, b) {
  if (a === b) return true
  const stripA = a.endsWith('/') ? a.slice(0, -1) : a
  const stripB = b.endsWith('/') ? b.slice(0, -1) : b
  return stripA === stripB
}

/**
 * @param {Set<string>} ids
 * @param {string} value
 * @returns {boolean}
 */
function idSetHas(ids, value) {
  // The linear fallback handles trailing-slash URI variants the O(1)
  // membership check misses; do not replace this with a bare ids.has().
  if (ids.has(value)) return true
  for (const id of ids) {
    if (idMatches(id, value)) return true
  }
  return false
}

/**
 * Check whether a $ref is clearly unresolvable. Throws with ajv-compatible
 * message on the FIRST clearly-unresolvable ref found.
 *
 * @param {object} schema - the route schema (already merge-patch-expanded)
 * @param {object} externalSchemas - the externalSchemas map from the pool
 */
function checkRefs(schema, externalSchemas) {
  const refs = []
  collectRefs(schema, refs)
  if (refs.length === 0) return

  const localIds = new Set()
  collectIds(schema, localIds)

  const extKeys = externalSchemas ? Object.keys(externalSchemas) : []

  for (const ref of refs) {
    // Local JSON-pointer refs (#/...) are always accepted.
    if (ref.startsWith('#/')) continue

    // Anchor-style local ref: starts with '#' but has no slash.
    if (ref.startsWith('#')) {
      const name = ref.slice(1) // e.g. "notExist" from "#notExist"
      // Accept if we find a matching $id or $anchor in the local schema.
      // Two lookups on purpose: collectIds stores $id values verbatim
      // ("#notExist" matches via ref) while $anchor values are stored bare
      // ("notExist" matches via name). This branch uses strict equality
      // throughout: anchor names are never URI-style, so trailing-slash
      // normalization does not apply here.
      if (localIds.has(ref) || localIds.has(name)) continue
      // Accept if any external schema key or nested $id resolves it.
      if (extKeys.some(k => k === ref || k === name)) continue
      if (extKeys.some(k => {
        const ext = externalSchemas[k]
        if (!ext || typeof ext !== 'object') return false
        const extIds = new Set()
        collectIds(ext, extIds)
        return extIds.has(ref) || extIds.has(name)
      })) continue
      // Clearly unresolvable anchor.
      throw new Error(`can't resolve reference ${ref} from id #`)
    }

    // External ref: "base" or "base#fragment"
    const hashIdx = ref.indexOf('#')
    const base = hashIdx === -1 ? ref : ref.slice(0, hashIdx)
    if (!base) continue // bare '#' or '#/...' already handled above

    // Accept if base matches any external schema key
    // (trailing-slash-insensitive for URI-style ids).
    if (extKeys.some(k => idMatches(k, base))) continue

    // Accept if base is found as any nested $id in the local schema.
    if (idSetHas(localIds, base)) continue

    // Accept if base matches any nested $id in any external schema.
    if (extKeys.some(k => {
      const ext = externalSchemas[k]
      if (!ext || typeof ext !== 'object') return false
      const extIds = new Set()
      collectIds(ext, extIds)
      return idSetHas(extIds, base)
    })) continue

    // Clearly unresolvable external ref.
    throw new Error(`can't resolve reference ${ref} from id #`)
  }
}

module.exports = { checkRefs }
