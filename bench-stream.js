'use strict'
// Streams a 100 MB record body (ndjson for the stream routes, a JSON array for
// the buffered one) over a real socket, generated on the fly so the client
// holds nothing, and reports time to the response and the server's peak RSS.
const { fork } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

const MB = 1024 * 1024
const TARGET = Number(process.env.MB || 100) * MB
const BAD_AT = 50 // the invalid record's index in the early-invalid case

function line (i, bad) {
  return `{"id":${i + 1},"email":"user${i}@example.com","name":"Customer ${i}","qty":${bad ? -1 : i % 7}}`
}

function start (mode) {
  return new Promise((resolve) => {
    const child = fork(path.join(__dirname, 'bench-stream-server.js'), [mode], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
    child.once('message', (m) => resolve({ child, port: m.port }))
  })
}

function send (port, array, invalidAt) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint()
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/import', headers: { 'content-type': array ? 'application/json' : 'application/x-ndjson', 'transfer-encoding': 'chunked' } })
    let sent = 0
    let i = 0
    let done = false
    req.on('response', (r) => {
      let text = ''
      r.on('data', (d) => { text += d })
      r.on('end', () => { done = true; resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: r.statusCode, body: text.slice(0, 120), sentMB: (sent / MB).toFixed(1) }) })
    })
    req.on('error', (e) => { if (!done) resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: 0, body: e.code, sentMB: (sent / MB).toFixed(1) }) })
    if (array) req.write('[')
    const pump = () => {
      while (sent < TARGET && !done) {
        const parts = []
        let bytes = 0
        while (bytes < 256 * 1024 && sent + bytes < TARGET) {
          const s = line(i, invalidAt === i) + (array ? ',' : '\n')
          parts.push(s); bytes += s.length; i++
        }
        const chunk = parts.join('')
        sent += chunk.length
        if (!req.write(chunk)) { req.once('drain', pump); return }
      }
      if (!done) { if (array) req.write(line(i, false) + ']'); req.end() }
    }
    pump()
  })
}

function mem (port) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/mem' }, (r) => { let t = ''; r.on('data', (d) => { t += d }); r.on('end', () => resolve(JSON.parse(t))) })
  })
}

async function scenario (mode, invalid) {
  const { child, port } = await start(mode)
  const base = await mem(port)
  const r = await send(port, mode === 'buffered', invalid ? BAD_AT : -1)
  // The 400 closed the connection on the stream path; /mem is a new one.
  const after = await mem(port)
  child.kill()
  const peakMB = ((after.maxRSS - base.maxRSS) / 1024).toFixed(0)
  console.log(`${mode.padEnd(9)} ${(invalid ? 'early-invalid' : 'valid').padEnd(14)} status ${r.status} in ${r.ms.toFixed(0).padStart(6)} ms, sent ${r.sentMB.padStart(5)} MB, server peak RSS +${peakMB} MB  ${r.body.replace(/\s+/g, ' ')}`)
}

async function main () {
  for (const invalid of [true, false]) {
    for (const mode of ['buffered', 'stream', 'count']) await scenario(mode, invalid)
  }
}
main()
