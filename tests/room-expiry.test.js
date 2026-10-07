import { captchaFetch as fetch } from './helpers/captcha.js'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import Database from 'better-sqlite3'
import { io as connectSocket } from 'socket.io-client'
import { ROOM_LIFETIME_MS, roomExpired, roomTimeLeft } from '../src/shared/room-lifetime.js'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-expiry-'))
process.env.DATA_DIR = directory; process.env.PORT = '0'; process.env.NODE_ENV = 'test'; process.env.PUBLIC_ORIGIN = ''
const { httpServer, closeServer, cleanupSessions } = await import('../src/server/index.js')
const { db, getRoomById } = await import('../src/server/db.js')
if (!httpServer.listening) await new Promise(resolve => httpServer.once('listening', resolve))
const base = `http://127.0.0.1:${httpServer.address().port}`
after(async () => { await closeServer(); fs.rmSync(directory, { recursive: true, force: true }) })
async function request(url, method = 'GET', body, headers = {}) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: res.status, body: res.status === 204 ? null : await res.json() }
}
const create = async (templateId = 'office-lan') => (await request('/api/rooms', 'POST', { name: '24-hour room', displayName: 'Owner', templateId, expiresAt: '2100-01-01T00:00:00.000Z' })).body
function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timed out`)), 3500)
    socket.once(name, value => { clearTimeout(timer); resolve(value) })
  })
}
async function member(owner) {
  const socket = connectSocket(base, { auth: { roomId: owner.room.id, sessionId: owner.sessionId }, transports: ['websocket'], reconnection: false, autoConnect: false })
  const synced = event(socket, 'room:sync'); socket.connect(); await synced; return socket
}
test('creation gives exactly 24 hours and joins/edits cannot extend the fixed expiry', async () => {
  const owner = await create(), root = `/api/rooms/${owner.room.id}`, headers = { 'x-session-id': owner.sessionId }
  assert.equal(Date.parse(owner.room.expiresAt) - Date.parse(owner.room.createdAt), ROOM_LIFETIME_MS)
  const updated = await request(root, 'PATCH', { name: 'Changed', expiresAt: '2100-01-01T00:00:00.000Z' }, headers)
  assert.equal(updated.body.room.expiresAt, owner.room.expiresAt)
  const joined = await request('/api/rooms/join', 'POST', { joinCode: owner.room.joinCode, displayName: 'Editor' })
  assert.equal(joined.body.room.expiresAt, owner.room.expiresAt)
  const node = owner.topology.nodes[0]
  assert.equal((await request(root + '/nodes/' + node.id, 'PATCH', { ...node, label: 'Edited' }, { ...headers, 'x-topology-revision': '1' })).status, 200)
  assert.equal(getRoomById(owner.room.id).expiresAt, owner.room.expiresAt)
  assert.equal((await request('/api/rooms', 'GET', null, headers)).body.rooms.find(r => r.id === owner.room.id).expiresAt, owner.room.expiresAt)
})
test('expired rooms reject resume, recovery, join, planning, agent and socket operations without altering topology', async () => {
  const owner = await create(), root = `/api/rooms/${owner.room.id}`, headers = { 'x-session-id': owner.sessionId }
  const probe = (await request(root + '/planning/probes', 'POST', { name: 'Office Probe', segmentId: 'office' }, headers)).body
  const queued = await request(root + `/planning/probes/${probe.id}/jobs`, 'POST', { kind: 'host', target: '10.50.0.10' }, headers)
  assert.equal(queued.status, 201)
  const socket = await member(owner)
  try {
    db.prepare('UPDATE rooms SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1).toISOString(), owner.room.id)
    for (const [url, method, body] of [[root, 'GET'], [root + '/resume', 'POST'], [root + '/recovery', 'POST'], [root + '/planning', 'GET'], [root + '/nodes', 'POST', { type: 'pc', label: 'Too late', position: { x: 0, y: 0 }, data: {} }]]) {
      const result = await request(url, method, body, headers); assert.equal(result.status, 410); assert.equal(result.body.error, 'ROOM_EXPIRED')
    }
    const joined = await request('/api/rooms/join', 'POST', { joinCode: owner.room.joinCode, displayName: 'Owner', recoveryKey: owner.recoveryKey })
    assert.equal(joined.status, 410)
    assert.equal((await request('/api/session', 'GET', null, { cookie: `netaxis-session=${owner.sessionId}; netaxis-room=${owner.room.id}` })).status, 410)
    assert.equal((await request('/api/rooms', 'GET', null, headers)).body.rooms.some(r => r.id === owner.room.id), false)
    const auth = { Authorization: `Bearer ${probe.token}` }
    assert.equal((await request(`/api/probes/${probe.id}/jobs`, 'GET', null, auth)).status, 410)
    assert.equal((await request(`/api/probes/${probe.id}/jobs/${queued.body.id}/result`, 'POST', {}, auth)).status, 410)
    const result = await new Promise(resolve => socket.emit('node:create', { expectedRevision: 1, payload: { type: 'pc', label: 'Late socket write', position: { x: 0, y: 0 }, data: {} } }, resolve))
    assert.equal(result.error, 'ROOM_EXPIRED')
    assert.equal(getRoomById(owner.room.id).revision, 1)
    assert.equal(db.prepare('SELECT count(*) AS n FROM nodes WHERE room_id = ?').get(owner.room.id).n, owner.topology.nodes.length)
    const expired = event(socket, 'room:expired'), disconnected = event(socket, 'disconnect')
    cleanupSessions(); await expired; await disconnected
    const retry = connectSocket(base, { auth: { roomId: owner.room.id, sessionId: owner.sessionId }, transports: ['websocket'], reconnection: false, autoConnect: false })
    try { const failed = event(retry, 'connect_error'); retry.connect(); assert.equal((await failed).data.code, 'ROOM_EXPIRED') } finally { retry.disconnect() }
  } finally { socket.disconnect() }
})
test('connected room members receive expiry and disconnect at the scheduled deadline', async () => {
  const owner = await create()
  db.prepare('UPDATE rooms SET expires_at = ? WHERE id = ?').run(new Date(Date.now() + 1000).toISOString(), owner.room.id)
  const socket = await member(owner)
  try { const expired = event(socket, 'room:expired'), disconnected = event(socket, 'disconnect'); await expired; await disconnected; assert.equal(socket.connected, false) }
  finally { socket.disconnect() }
})
test('expiry is inclusive at the boundary and remaining time never becomes negative', () => {
  const room = { expiresAt: '2026-10-07T00:00:00.000Z' }, boundary = Date.parse(room.expiresAt)
  assert.equal(roomExpired(room, boundary - 1), false)
  assert.equal(roomExpired(room, boundary), true)
  assert.equal(roomTimeLeft(room, boundary - ROOM_LIFETIME_MS), 'เหลือ 24 ชม. 0 นาที')
  assert.equal(roomTimeLeft(room, boundary + 99999), 'หมดอายุแล้ว')
})
test('legacy migration grants one day once and preserves rooms and expiry across repeated starts', async () => {
  const legacyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-legacy-expiry-'))
  const legacy = new Database(path.join(legacyDirectory, 'netaxis.sqlite'))
  legacy.exec("CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, join_code TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', access_mode TEXT NOT NULL DEFAULT 'editor', revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
  legacy.prepare('INSERT INTO rooms (id,name,join_code,created_at,updated_at) VALUES (?,?,?,?,?)').run('legacy', 'Existing work', 'LEGACYROOM', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'); legacy.close()
  async function migrate() {
    const child = spawn(process.execPath, ['--input-type=module', '-e', "const { db, getRoomById } = await import('./src/server/db.js'); console.log(JSON.stringify(getRoomById('legacy'))); db.close()"], { env: { ...process.env, DATA_DIR: legacyDirectory }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let output = '', error = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { error += data })
    assert.equal(await new Promise(resolve => child.once('exit', resolve)), 0, error)
    return JSON.parse(output)
  }
  try {
    const before = Date.now(), first = await migrate(), after = Date.now()
    assert.equal(first.name, 'Existing work')
    assert.ok(Date.parse(first.expiresAt) >= before + ROOM_LIFETIME_MS && Date.parse(first.expiresAt) <= after + ROOM_LIFETIME_MS)
    assert.equal((await migrate()).expiresAt, first.expiresAt)
  } finally { fs.rmSync(legacyDirectory, { recursive: true, force: true }) }
})
