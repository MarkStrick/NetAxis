import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { io } from 'socket.io-client'
import { captchaFetch } from './helpers/captcha.js'
import { captchaDigest } from '../src/server/lib/captcha.js'
import { DEFAULT_ROOM_NAME } from '../src/shared/room-defaults.js'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-community-'))
process.env.PORT = '0'; process.env.DATA_DIR = directory; process.env.NODE_ENV = 'test'; process.env.PUBLIC_ORIGIN = ''
const { httpServer, closeServer } = await import('../src/server/index.js')
const { db } = await import('../src/server/db.js')
if (!httpServer.listening) await new Promise(resolve => httpServer.once('listening', resolve))
const base = `http://127.0.0.1:${httpServer.address().port}`
after(async () => { await closeServer(); fs.rmSync(directory, { recursive: true, force: true }) })
async function request(url, method = 'GET', body, token, raw = false, cookie = '') {
  const response = await (raw ? fetch : captchaFetch)(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-session-id': token } : {}), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, body: response.status === 204 ? null : await response.json(), response }
}
async function challenge() {
  const result = await request('/api/captcha')
  const cookie = result.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  db.prepare('UPDATE captcha_challenges SET answer_hash=? WHERE id=?').run(captchaDigest(result.body.id, '123456'), result.body.id)
  return { proof: { id: result.body.id, answer: '123456' }, cookie, body: result.body }
}
const create = async () => (await request('/api/rooms', 'POST', { name: 'Community room', displayName: 'Owner' })).body
test('room creation supplies a default name for omitted, empty and whitespace names', async () => {
  for (const fields of [{}, { name: '' }, { name: '  ' }]) {
    const result = await request('/api/rooms', 'POST', { ...fields, displayName: 'Owner' })
    assert.equal(result.status, 201)
    assert.equal(result.body.room.name, DEFAULT_ROOM_NAME)
  }
  assert.equal((await request('/api/rooms', 'POST', { name: 'x'.repeat(101), displayName: 'Owner' })).status, 400)
})
function event(socket, name) {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Missing ${name}`)), 3000); socket.once(name, value => { clearTimeout(timer); resolve(value) }) })
}
async function connect(member) {
  const socket = io(base, { auth: { roomId: member.room.id, sessionId: member.sessionId }, transports: ['websocket'], reconnection: false })
  await event(socket, 'room:sync'); return socket
}
test('first-visit verification unlocks repeated room creation and joining without more captcha', async () => {
  assert.equal((await request('/api/visitor')).body.verified, false)
  for (const url of ['/api/rooms', '/api/rooms/join', '/api/rooms/restore']) assert.equal((await request(url, 'POST', {}, null, true)).body.error, 'VISITOR_UNVERIFIED')
  const value = await challenge()
  assert.deepEqual(Object.keys(value.body).sort(), ['expiresAt', 'id', 'image'])
  assert.ok(value.body.image.startsWith('data:image/png;base64,'))
  assert.equal(Buffer.from(value.body.image.split(',')[1], 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  const proof = { captcha: value.proof }
  assert.equal((await request('/api/captcha/verify', 'POST', proof, null, true, 'netaxis-captcha=other-browser')).body.error, 'CAPTCHA_INVALID')
  const verified = await request('/api/captcha/verify', 'POST', proof, null, true, value.cookie)
  assert.equal(verified.status, 200)
  const cookie = verified.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.equal((await request('/api/visitor', 'GET', undefined, null, true, cookie)).body.verified, true)
  assert.equal((await request('/api/captcha/verify', 'POST', proof, null, true, value.cookie)).body.error, 'CAPTCHA_INVALID')
  const body = { name: 'Protected room', displayName: 'Owner' }
  const first = await request('/api/rooms', 'POST', body, null, true, cookie)
  assert.equal(first.status, 201)
  assert.equal((await request('/api/rooms', 'POST', body, null, true, cookie)).status, 201)
  assert.equal((await request('/api/rooms/join', 'POST', { joinCode: first.body.room.joinCode, displayName: 'Viewer', role: 'viewer' }, null, true, cookie)).status, 200)
  assert.equal((await request('/api/visitor', 'GET', undefined, null, true, 'netaxis-verified=forged-token')).body.verified, false)
  db.prepare('UPDATE captcha_visitors SET expires_at=0').run()
  assert.equal((await request('/api/visitor', 'GET', undefined, null, true, cookie)).body.verified, false)
})
test('wrong and expired captcha cannot be replayed; concurrent requests consume it once', async () => {
  let value = await challenge()
  const input = captcha => ({ captcha })
  assert.equal((await request('/api/captcha/verify', 'POST', input({ ...value.proof, answer: '654321' }), null, true, value.cookie)).body.error, 'CAPTCHA_INVALID')
  assert.equal((await request('/api/captcha/verify', 'POST', input(value.proof), null, true, value.cookie)).body.error, 'CAPTCHA_INVALID')
  value = await challenge(); db.prepare('UPDATE captcha_challenges SET expires_at=0 WHERE id=?').run(value.proof.id)
  assert.equal((await request('/api/captcha/verify', 'POST', input(value.proof), null, true, value.cookie)).body.error, 'CAPTCHA_INVALID')
  value = await challenge()
  const results = await Promise.all([0, 1].map(() => request('/api/captcha/verify', 'POST', input(value.proof), null, true, value.cookie)))
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400])
})
test('room chat is durable, isolated, authorized, rate limited and broadcast to viewers', async () => {
  const owner = await create(), other = await create(), root = `/api/rooms/${owner.room.id}`
  const viewer = (await request('/api/rooms/join', 'POST', { joinCode: owner.room.joinCode, displayName: 'Viewer', role: 'viewer' })).body
  const ownerSocket = await connect(owner), viewerSocket = await connect(viewer)
  try {
    assert.equal((await request(root + '/messages')).status, 401)
    assert.equal((await request(root + '/messages', 'GET', undefined, other.sessionId)).status, 401)
    const delivery = event(ownerSocket, 'room:message')
    const result = await request(root + '/messages', 'POST', { text: '  <img src=x onerror=alert(1)>\nทีมพร้อมแล้ว  ', clientId: 'viewer-message-1', displayName: 'Spoofed', role: 'owner' }, viewer.sessionId)
    assert.equal(result.status, 201); assert.equal(result.body.message.displayName, 'Viewer'); assert.equal(result.body.message.role, 'viewer')
    assert.equal(result.body.message.text, '<img src=x onerror=alert(1)>\nทีมพร้อมแล้ว')
    assert.deepEqual((await delivery).message, result.body.message)
    const retry = await request(root + '/messages', 'POST', { text: 'Changed retry', clientId: 'viewer-message-1' }, viewer.sessionId)
    assert.deepEqual(retry.body.message, result.body.message)
    assert.equal((await request(root + '/messages', 'POST', { text: 'spam', clientId: 'viewer-message-2' }, viewer.sessionId)).status, 429)
    assert.equal((await request(root + '/messages', 'POST', { text: ' '.repeat(10), clientId: 'empty-message' }, owner.sessionId)).status, 400)
    assert.equal((await request(root + '/messages', 'POST', { text: 'x'.repeat(1001), clientId: 'long-message' }, owner.sessionId)).status, 400)
    const history = (await request(root + '/messages', 'GET', undefined, owner.sessionId)).body
    assert.equal(history.messages.length, 1)
    assert.deepEqual((await request(root + '/messages?after=' + history.cursor, 'GET', undefined, viewer.sessionId)).body.messages, [])
    assert.equal((await request(root + '/messages?after=invalid', 'GET', undefined, owner.sessionId)).status, 400)
    const changed = await request(root + '/member-status', 'PATCH', { status: 'busy', participantId: owner.participant.id }, viewer.sessionId)
    assert.equal(changed.body.participants.find(m => m.id === viewer.participant.id).status, 'busy')
    assert.equal(changed.body.participants.find(m => m.id === owner.participant.id).status, 'online')
    assert.equal((await request(root + '/member-status', 'PATCH', { status: 'admin' }, viewer.sessionId)).status, 400)
    const offline = event(ownerSocket, 'room:presence'); viewerSocket.disconnect()
    assert.equal((await offline).participants.find(m => m.id === viewer.participant.id).status, 'offline')
    assert.equal((await request(root + '/messages', 'GET', undefined, owner.sessionId)).body.messages[0].id, result.body.message.id)
    db.prepare('UPDATE rooms SET expires_at=? WHERE id=?').run(new Date(0).toISOString(), owner.room.id)
    assert.equal((await request(root + '/messages', 'GET', undefined, owner.sessionId)).status, 410)
  } finally { ownerSocket.disconnect(); viewerSocket.disconnect() }
})
test('chat retains the latest 100 messages in chronological order and does not change topology revision', async () => {
  const owner = await create(), root = `/api/rooms/${owner.room.id}`
  for (let i = 0; i < 105; i++) {
    // Advancing a participant's rate window avoids wall-clock waits in the fixture.
    db.prepare('DELETE FROM room_chat_limits WHERE room_id=?').run(owner.room.id)
    assert.equal((await request(root + '/messages', 'POST', { text: `message ${i}`, clientId: `retention-${i}` }, owner.sessionId)).status, 201)
  }
  const history = (await request(root + '/messages', 'GET', undefined, owner.sessionId)).body
  assert.equal(history.messages.length, 100); assert.equal(history.messages[0].text, 'message 5'); assert.equal(history.messages.at(-1).text, 'message 104')
  assert.equal(history.cursor, history.messages.at(-1).id)
  assert.equal((await request(root, 'GET', undefined, owner.sessionId)).body.room.revision, 0)
  assert.equal((await request(root, 'DELETE', undefined, owner.sessionId)).status, 204)
  assert.equal(db.prepare('SELECT count(*) AS n FROM room_messages WHERE room_id=?').get(owner.room.id).n, 0)
})
