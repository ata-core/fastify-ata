'use strict'

// Preload that makes Fastify use ata as its GLOBAL default validator, by
// intercepting the single `require('@fastify/ajv-compiler')` in Fastify's
// schema-controller and returning the ata factory instead.
//
// Usage (from a Fastify checkout):
//   node --require /abs/path/fastify-ata/compat/ata-default-preload.js \
//        --test test/schema-validation.test.js
//
// Tests that build their own AJV instance (require('ajv')) or set a custom
// validatorCompiler bypass this and keep using AJV, as they should.

const Module = require('module')
const path = require('path')
const AtaCompiler = require(path.join(__dirname, '..', 'compiler'))

const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '@fastify/ajv-compiler') {
    return AtaCompiler
  }
  return origLoad.apply(this, arguments)
}
