import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { io as socketClient } from 'socket.io-client'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-security-'))
process.env.DATA_DIR = directory
process.env.PORT = '0'
process.env.NODE_ENV = 'test'
process.env.PUBLIC_ORIGIN = ''
const { httpServer, closeServer } = await import('../src/server/index.js')
if (!httpServer.listening) await new Promise(resolve => httpServer.once('listening', resolve))
const base = 'http://127.0.0.1:' + httpServer.address().port
async function request(url, options = {}) {
  const response = await fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  return { response, body: response.status === 204 ? null : await response.json() }
}
after(async () => { await closeServer(); fs.rmSync(directory, { recursive: true, force: true }) })

test('visitors can create rooms immediately while room data stays private', async () => {
  const rooms = await request('/api/rooms')
  assert.equal(rooms.response.status, 200)
  assert.deepEqual(rooms.body.rooms, [])
  const created = await request('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Open workspace', displayName: 'Owner' }) })
  assert.equal(created.response.status, 201)
  assert.match(created.response.headers.get('set-cookie'), /HttpOnly/i)
  assert.match(created.response.headers.get('set-cookie'), /SameSite=Strict/i)
  assert.equal((await request('/api/rooms/' + created.body.room.id)).response.status, 401)
  assert.deepEqual((await request('/api/rooms')).body.rooms, [])
  const cookie = created.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.equal((await request('/api/session', { headers: { cookie } })).body.participant.role, 'owner')
})
test('cross-site browser requests are rejected and security headers are present', async () => {
  assert.equal((await request('/api/rooms', { headers: { origin: 'https://attacker.example' } })).response.status, 403)
  const rooms = await request('/api/rooms')
  assert.equal(rooms.response.headers.get('x-powered-by'), null)
  assert.match(rooms.response.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal(rooms.response.headers.get('x-content-type-options'), 'nosniff')
})
test('sockets accept room members and reject missing room credentials', async () => {
  const created = (await request('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Socket room', displayName: 'Owner' }) })).body
  const member = socketClient(base, { auth: { roomId: created.room.id, sessionId: created.sessionId }, transports: ['websocket'], reconnection: false })
  try {
    const sync = await new Promise((resolve, reject) => { member.once('room:sync', resolve); member.once('connect_error', reject); setTimeout(() => reject(new Error('Sync timed out')), 3000).unref() })
    assert.equal(sync.room.id, created.room.id)
  } finally { member.disconnect() }
  const anonymous = socketClient(base, { auth: { roomId: created.room.id }, transports: ['websocket'], reconnection: false })
  try {
    await new Promise((resolve, reject) => { anonymous.once('connect_error', resolve); anonymous.once('connect', () => reject(new Error('Anonymous socket connected'))); setTimeout(() => reject(new Error('Handshake timed out')), 3000).unref() })
  } finally { anonymous.disconnect() }
})
test('removed login endpoints return not found', async () => {
  for (const url of ['/api/access', '/api/access/login', '/api/access/logout']) {
    assert.equal((await request(url, url === '/api/access' ? {} : { method: 'POST', body: '{}' })).response.status, 404)
  }
})
