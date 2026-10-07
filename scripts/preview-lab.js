// Isolated browser QA fixture. Never runs against the user's database or production.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
process.env.NODE_ENV = 'test'
process.env.HOST = '127.0.0.1'
process.env.PORT = '0'
process.env.PUBLIC_ORIGIN = ''
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-lab-preview-'))
const { httpServer, closeServer } = await import('../src/server/index.js')
const { db } = await import('../src/server/db.js')
const { captchaDigest } = await import('../src/server/lib/captcha.js')
if (!httpServer.listening) await new Promise(resolve => httpServer.once('listening', resolve))
const origin = `http://127.0.0.1:${httpServer.address().port}`
const challengeResponse = await fetch(origin + '/api/captcha')
const challenge = await challengeResponse.json()
db.prepare('UPDATE captcha_challenges SET answer_hash=? WHERE id=?').run(captchaDigest(challenge.id, '123456'), challenge.id)
const bindingCookie = challengeResponse.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
const verified = await fetch(origin + '/api/captcha/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: bindingCookie }, body: JSON.stringify({ captcha: { id: challenge.id, answer: '123456' } }) })
if (!verified.ok) throw new Error('Fixture verification failed')
const verifiedCookies = verified.headers.getSetCookie()
const creation = await fetch(origin + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: verifiedCookies.map(c => c.split(';')[0]).join('; ') }, body: JSON.stringify({ templateId: 'office-lan', name: 'Network Lab · QA', displayName: 'QA Engineer' }) })
if (!creation.ok) throw new Error('Fixture room creation failed')
const fixture = await creation.json(), fixtureCookies = [...verifiedCookies, ...creation.headers.getSetCookie()]
const proxy = createServer(async (req, res) => {
  if (req.url === '/__fixture') { res.writeHead(302, { 'Set-Cookie': fixtureCookies, Location: `/room/${fixture.room.id}` }); res.end(); return }
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const response = await fetch(origin + req.url, { method: req.method, headers: { ...req.headers, host: new URL(origin).host, ...(req.headers.origin ? { origin } : {}) }, body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) })
    const headers = Object.fromEntries(response.headers); delete headers['content-encoding']; delete headers['content-length']; delete headers['set-cookie']
    if (response.headers.getSetCookie().length) headers['set-cookie'] = response.headers.getSetCookie()
    res.writeHead(response.status, headers); res.end(Buffer.from(await response.arrayBuffer()))
  } catch { res.writeHead(502); res.end('QA proxy failed') }
}).listen(3108, '127.0.0.1', () => console.log('Isolated lab preview: http://127.0.0.1:3108/__fixture'))
proxy.on('upgrade', (req, socket, head) => {
  const upstream = createConnection(httpServer.address().port, '127.0.0.1', () => {
    const headers = { ...req.headers, host: new URL(origin).host, origin }
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
    if (head.length) upstream.write(head)
    socket.pipe(upstream); upstream.pipe(socket)
  })
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy())
})
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { proxy.close(); closeServer().then(() => process.exit(0)) })
