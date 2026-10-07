import { captchaFetch as fetch } from './helpers/captcha.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { io } from 'socket.io-client'
const root = fileURLToPath(new URL('../', import.meta.url))

test('post-deployment command passes a healthy frontend and fails when API routing returns HTML', { timeout: 10000 }, async () => {
  let broken = false
  const fixture = http.createServer((req, res) => {
    assert.equal(req.method, 'GET')
    if (req.url === '/assets/entry.js') { res.setHeader('Content-Type', 'application/javascript'); res.end('/* built app */'); return }
    if (req.url === '/api/health' && !broken) { res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify({ ok: true, service: 'netaxis-topology' })); return }
    res.setHeader('Content-Security-Policy', "default-src 'self'")
    res.setHeader('Content-Type', 'text/html')
    res.end('<html><title>NETAXIS</title><script src="/assets/entry.js"></script></html>')
  })
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
  async function run() {
    const child = spawn(process.execPath, ['scripts/check-deployment.js', `http://127.0.0.1:${fixture.address().port}`], { cwd: root, windowsHide: true, stdio: 'pipe' })
    let output = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
    return { code, output }
  }
  try {
    const result = await run(); assert.equal(result.code, 0, result.output); assert.match(result.output, /PASS:/)
    broken = true
    const failed = await run(); assert.equal(failed.code, 1); assert.match(failed.output, /Deployment check failed/)
  } finally { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)) }
})

test('Vercel serves API in the same project and never caches private responses', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'))
  assert.equal(config.outputDirectory, 'dist')
  assert.equal(config.rewrites[0].source, '/api/:path*')
  assert.equal(config.rewrites[0].destination, '/api?__path=:path*')
  assert.ok(config.rewrites.every(rule => !rule.destination.startsWith('https:')))
  assert.equal(config.headers.find(rule => rule.source === '/api/:path*').headers.find(h => h.key === 'Cache-Control').value, 'no-store')
  assert.ok(config.functions['api/index.js'])
})

test('Docker runtime file selection boots production and supports proxied REST cookies plus direct WebSocket', { timeout: 25000 }, async () => {
  // Run the exact files selected by Docker COPY without requiring a local Docker daemon.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-runtime-'))
  let child, proxy
  try {
    const lines = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8').split(/\r?\n/)
    for (const line of lines.filter(line => line.startsWith('COPY --from=build '))) {
      const parts = line.split(/\s+/).slice(3), destination = parts.pop()
      const target = path.resolve(stage, destination)
      assert.ok(target === stage || target.startsWith(stage + path.sep))
      for (const source of parts) {
        const sourcePath = path.join(root, source.replace('/app/', ''))
        if (source === '/app/node_modules') fs.symlinkSync(sourcePath, target, process.platform === 'win32' ? 'junction' : 'dir')
        else if (parts.length > 1) fs.copyFileSync(sourcePath, path.join(target, path.basename(source)))
        else fs.cpSync(sourcePath, target, { recursive: true })
      }
    }
    child = spawn(process.execPath, ['scripts/start.js'], { cwd: stage, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', PUBLIC_ORIGIN: 'https://frontend.example.com', DATA_DIR: path.join(stage, 'data'), TRUST_PROXY: '' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const base = await new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('Runtime startup timed out: ' + output)), 10000)
      child.stdout.on('data', data => { output += data; const match = output.match(/listening on http:\/\/[^:]+:(\d+)/); if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]) } })
      child.stderr.on('data', data => { output += data })
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Runtime failed: ' + code + ' ' + output)) })
    })
    assert.equal((await fetch(base + '/api/health')).status, 200)
    const html = await (await fetch(base)).text(), asset = html.match(/src="([^"]+\.js)"/)[1]
    assert.equal((await fetch(base + asset)).status, 200)
    proxy = http.createServer((req, res) => {
      const upstream = http.request(new URL(req.url, base), { method: req.method, headers: { ...req.headers, host: new URL(base).host } }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res) })
      upstream.on('error', () => { res.writeHead(502); res.end() }); req.pipe(upstream)
    })
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
    const front = `http://127.0.0.1:${proxy.address().port}`
    process.env.DATA_DIR = path.join(stage, 'data')
    const created = await fetch(front + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://frontend.example.com' }, body: JSON.stringify({ name: 'Proxy workspace', displayName: 'Owner', templateId: 'office-lan' }) })
    assert.equal(created.status, 201)
    const cookie = created.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
    assert.match(created.headers.get('set-cookie'), /Secure/)
    assert.equal(created.headers.get('cache-control'), 'no-store')
    const owner = await created.json()
    const resumed = await (await fetch(front + '/api/session', { headers: { cookie, Origin: 'https://frontend.example.com' } })).json()
    assert.equal(resumed.sessionId, owner.sessionId)
    const socket = io(base, { auth: { roomId: owner.room.id, sessionId: resumed.sessionId }, extraHeaders: { Origin: 'https://frontend.example.com' }, transports: ['websocket'], reconnection: false })
    try {
      const sync = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Direct socket timeout')), 3000); socket.once('room:sync', value => { clearTimeout(timer); resolve(value) }); socket.once('connect_error', err => { clearTimeout(timer); reject(err) }) })
      assert.equal(sync.nodes.length, owner.topology.nodes.length)
    } finally { socket.disconnect() }
    const denied = io(base, { auth: { roomId: owner.room.id, sessionId: resumed.sessionId }, extraHeaders: { Origin: 'https://untrusted.example.com' }, transports: ['websocket'], reconnection: false })
    try {
      await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Origin rejection timeout')), 3000); denied.once('connect_error', () => { clearTimeout(timer); resolve() }); denied.once('connect', () => { clearTimeout(timer); reject(new Error('Untrusted origin connected')) }) })
    } finally { denied.disconnect() }
    const backup = await fetch(front + `/api/rooms/${owner.room.id}/export`, { headers: { cookie } })
    assert.equal(backup.status, 200)
    assert.equal((await backup.json()).format, 'netaxis-workspace')
  } finally {
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)) }
    if (child && child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done }
    // Explicitly unlink the dependency junction before cleaning our temporary staging directory.
    const modules = path.join(stage, 'node_modules')
    if (fs.existsSync(modules) && fs.lstatSync(modules).isSymbolicLink()) fs.unlinkSync(modules)
    assert.ok(stage.startsWith(path.join(os.tmpdir(), 'netaxis-runtime-')))
    fs.rmSync(stage, { recursive: true, force: true })
  }
})
