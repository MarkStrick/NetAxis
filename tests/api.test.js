import { captchaFetch as fetch } from './helpers/captcha.js'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { io as connectSocket } from 'socket.io-client'

process.env.PORT = '0'
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-api-'))
process.env.DATA_DIR = testDirectory
process.env.NODE_ENV = 'test'
process.env.PUBLIC_ORIGIN = ''
const { httpServer, closeServer } = await import('../src/server/index.js')
const { clearDatabaseForTests, db } = await import('../src/server/db.js')
if (!httpServer.listening) await new Promise((resolve) => httpServer.once('listening', resolve))
clearDatabaseForTests()
const baseUrl = () => `http://127.0.0.1:${httpServer.address().port}`

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl()}${pathname}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const body = response.status === 204 ? null : await response.json()
  return { response, body }
}

test('creates rooms and persists nodes through revision-protected API', async () => {
  const created = await request('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Test Room', displayName: 'Owner', accessMode: 'editor' }) })
  assert.equal(created.response.status, 201)
  const { room, sessionId } = created.body
  const node = await request(`/api/rooms/${room.id}/nodes`, { method: 'POST', headers: { 'x-session-id': sessionId, 'x-topology-revision': '0' }, body: JSON.stringify({ type: 'router', label: 'Core Router', position: { x: 100, y: 100 }, data: { status: 'unknown' } }) })
  assert.equal(node.response.status, 201)
  assert.equal(node.body.room.revision, 1)
  const stale = await request(`/api/rooms/${room.id}/nodes`, { method: 'POST', headers: { 'x-session-id': sessionId, 'x-topology-revision': '0' }, body: JSON.stringify({ type: 'pc', label: 'Old Write', position: { x: 200, y: 200 }, data: { status: 'unknown' } }) })
  assert.equal(stale.response.status, 409)
  const loaded = await request(`/api/rooms/${room.id}`, { headers: { 'x-session-id': sessionId } })
  assert.equal(loaded.body.nodes.length, 1)
})

test('rejects duplicate IPv4 addresses and viewer mutations', async () => {
  const created = await request('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Validation Room', displayName: 'Owner', accessMode: 'editor' }) })
  const { room, sessionId } = created.body
  const first = await request(`/api/rooms/${room.id}/nodes`, { method: 'POST', headers: { 'x-session-id': sessionId, 'x-topology-revision': '0' }, body: JSON.stringify({ type: 'server', label: 'Server 1', position: { x: 0, y: 0 }, data: { ipv4: '10.0.0.5', cidr: 24, status: 'online' } }) })
  const duplicate = await request(`/api/rooms/${room.id}/nodes`, { method: 'POST', headers: { 'x-session-id': sessionId, 'x-topology-revision': `${first.body.room.revision}` }, body: JSON.stringify({ type: 'pc', label: 'Server 2', position: { x: 200, y: 0 }, data: { ipv4: '10.0.0.5', cidr: 24, status: 'online' } }) })
  assert.equal(duplicate.response.status, 400)
  const viewerRoom = await request('/api/rooms/join', { method: 'POST', body: JSON.stringify({ joinCode: room.joinCode, displayName: 'Viewer', role: 'viewer' }) })
  const denied = await request(`/api/rooms/${room.id}/nodes`, { method: 'POST', headers: { 'x-session-id': viewerRoom.body.sessionId, 'x-topology-revision': `${first.body.room.revision}` }, body: JSON.stringify({ type: 'pc', label: 'No Write', position: { x: 0, y: 0 }, data: { status: 'unknown' } }) })
  assert.equal(denied.response.status, 403)
})

test('deleting a node also removes its connected edges', async () => {
  const created = await request('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Delete Room', displayName: 'Owner', accessMode: 'editor' }) })
  const { room, sessionId } = created.body
  const first = await request(`/api/rooms/${room.id}/nodes`, { method: 'POST', headers: { 'x-session-id': sessionId, 'x-topology-revision': '0' }, body: JSON.stringify({ type: 'router', label: 'Router', position: { x: 0, y: 0 }, data: { status: 'online' } }) })
  const second = await request(`/api/rooms/${room.id}/nodes`, { method: 'POST', headers: { 'x-session-id': sessionId, 'x-topology-revision': `${first.body.room.revision}` }, body: JSON.stringify({ type: 'pc', label: 'PC', position: { x: 200, y: 0 }, data: { status: 'online' } }) })
  const edge = await request(`/api/rooms/${room.id}/edges`, { method: 'POST', headers: { 'x-session-id': sessionId, 'x-topology-revision': `${second.body.room.revision}` }, body: JSON.stringify({ sourceNodeId: first.body.node.id, targetNodeId: second.body.node.id, label: 'LAN', medium: 'ethernet', status: 'active' }) })
  const deleted = await request(`/api/rooms/${room.id}/nodes/${first.body.node.id}`, { method: 'DELETE', headers: { 'x-session-id': sessionId, 'x-topology-revision': `${edge.body.room.revision}` } })
  assert.equal(deleted.response.status, 200)
  assert.deepEqual(deleted.body.node.edgeIds, [edge.body.edge.id])

  const loaded = await request(`/api/rooms/${room.id}`, { headers: { 'x-session-id': sessionId } })
  assert.equal(loaded.body.nodes.length, 1)
  assert.equal(loaded.body.edges.length, 0)
})

after(async () => { await closeServer(); fs.rmSync(testDirectory, { recursive: true, force: true }) })

async function create(name = 'Regression Room') {
  return (await request('/api/rooms', { method: 'POST', body: JSON.stringify({ name, displayName: 'Owner' }) })).body
}
const headersFor = (sessionId, revision) => ({ 'x-session-id': sessionId, 'x-topology-revision': String(revision) })
const device = (id, x = 0) => ({ id, type: 'router', label: id, position: { x, y: 0 }, data: { status: 'online' } })
async function importGraph(created, graph, revision = 0) {
  return request(`/api/rooms/${created.room.id}/topology/import`, { method: 'POST', headers: headersFor(created.sessionId, revision), body: JSON.stringify(graph) })
}
async function socketFor(created) {
  const socket = connectSocket(baseUrl(), { auth: { roomId: created.room.id, sessionId: created.sessionId }, transports: ['websocket'], reconnection: false })
  const sync = await new Promise((resolve, reject) => {
    socket.once('room:sync', resolve); socket.once('connect_error', reject)
    setTimeout(() => reject(new Error('Socket connection timed out')), 5000).unref()
  })
  return { socket, sync }
}
test('room discovery exposes only rooms joined by this browser', async () => {
  const created = await create()
  assert.deepEqual((await request('/api/rooms')).body.rooms, [])
  const mine = await request('/api/rooms', { headers: headersFor(created.sessionId, 0) })
  assert.equal(mine.body.rooms.length, 1)
  assert.equal(mine.body.rooms[0].id, created.room.id)
  const forbidden = await request(`/api/rooms/${created.room.id}`, { headers: { 'x-session-id': 'not-my-session' } })
  assert.equal(forbidden.response.status, 401)
})
test('importing an exported topology into a second room remaps collisions and preserves port sides', async () => {
  const first = await create(), second = await create()
  const graph = { nodes: [device('export-a'), device('export-b', 300)], edges: [{ id: 'export-edge', sourceNodeId: 'export-a', targetNodeId: 'export-b', sourceSide: 'left', targetSide: 'right', medium: 'fiber' }] }
  const original = await importGraph(first, graph)
  assert.equal(original.response.status, 200)
  const imported = await importGraph(second, original.body)
  assert.equal(imported.response.status, 200)
  assert.notEqual(imported.body.nodes[0].id, graph.nodes[0].id)
  assert.equal(imported.body.edges[0].sourceNodeId, imported.body.nodes[0].id)
  assert.equal(imported.body.edges[0].sourceSide, 'left')
  assert.equal(imported.body.edges[0].targetSide, 'right')
  assert.equal((await request(`/api/rooms/${first.room.id}`, { headers: headersFor(first.sessionId, 1) })).body.nodes[0].id, 'export-a')
})
test('invalid imports never clear the existing graph or advance its revision', async () => {
  const created = await create()
  await importGraph(created, { nodes: [device('kept-node')], edges: [] })
  for (const graph of [
    { nodes: [device('same'), device('same')], edges: [] },
    { nodes: [device('unique')], edges: [{ id: 'broken', sourceNodeId: 'unique', targetNodeId: 'missing' }] },
    { nodes: [device('unique')], edges: [{ id: 'self', sourceNodeId: 'unique', targetNodeId: 'unique' }] },
    { nodes: [device(undefined)], edges: [] },
  ]) {
    const result = await importGraph(created, graph, 1)
    assert.equal(result.response.status, 400)
    const saved = (await request(`/api/rooms/${created.room.id}`, { headers: headersFor(created.sessionId, 1) })).body
    assert.equal(saved.room.revision, 1); assert.equal(saved.nodes[0].id, 'kept-node')
  }
})
test('duplicate IDs and missing revisions produce controlled errors without corrupting data', async () => {
  const created = await create()
  const first = await request(`/api/rooms/${created.room.id}/nodes`, { method: 'POST', headers: headersFor(created.sessionId, 0), body: JSON.stringify(device('duplicate-id')) })
  assert.equal(first.response.status, 201)
  const duplicate = await request(`/api/rooms/${created.room.id}/nodes`, { method: 'POST', headers: headersFor(created.sessionId, 1), body: JSON.stringify(device('duplicate-id')) })
  assert.equal(duplicate.response.status, 409)
  const noRevision = await request(`/api/rooms/${created.room.id}/nodes`, { method: 'POST', headers: { 'x-session-id': created.sessionId }, body: JSON.stringify(device('another-id')) })
  assert.equal(noRevision.response.status, 409)
  assert.equal((await request(`/api/rooms/${created.room.id}`, { headers: headersFor(created.sessionId, 1) })).body.room.revision, 1)
})
test('websocket sync, edits, multi-tab presence and role revocation use authoritative access', async () => {
  const created = await create()
  const first = await socketFor(created), second = await socketFor(created)
  try {
    assert.equal(first.sync.room.id, created.room.id)
    assert.equal(second.sync.participants.filter(person => person.connected).length, 1)
    const incoming = new Promise(resolve => second.socket.once('node:create', resolve))
    const result = await first.socket.timeout(5000).emitWithAck('node:create', { expectedRevision: 0, payload: device('socket-node') })
    assert.equal(result.ok, true); assert.equal((await incoming).node.id, 'socket-node')
    // A malformed acknowledgement must not crash the process.
    first.socket.emit('node:update', null, 'not-a-callback')
    const stale = await first.socket.timeout(5000).emitWithAck('node:create', { expectedRevision: 0, payload: device('stale-socket-node') })
    assert.equal(stale.error, 'REVISION_CONFLICT')
    first.socket.disconnect()
    await new Promise(resolve => setTimeout(resolve, 30))
    const presence = await request(`/api/rooms/${created.room.id}/presence`, { headers: headersFor(created.sessionId, 1) })
    assert.equal(presence.body.participants[0].connected, true)
    const editor = (await request('/api/rooms/join', { method: 'POST', body: JSON.stringify({ joinCode: created.room.joinCode, displayName: 'Editor', role: 'editor' }) })).body
    const connection = await socketFor(editor)
    try {
      await request(`/api/rooms/${created.room.id}`, { method: 'PATCH', headers: headersFor(created.sessionId, 1), body: JSON.stringify({ accessMode: 'viewer' }) })
      const denied = await connection.socket.timeout(5000).emitWithAck('node:create', { expectedRevision: 1, payload: device('denied-editor') })
      assert.equal(denied.error, 'PERMISSION_DENIED')
      const restDenied = await request(`/api/rooms/${created.room.id}/nodes`, { method: 'POST', headers: headersFor(editor.sessionId, 1), body: JSON.stringify(device('denied-rest')) })
      assert.equal(restDenied.response.status, 403)
    } finally { connection.socket.disconnect() }
  } finally { first.socket.disconnect(); second.socket.disconnect() }
})
test('non-owner cannot change settings or delete a room and invalid JSON returns JSON errors', async () => {
  const created = await create()
  const editor = (await request('/api/rooms/join', { method: 'POST', body: JSON.stringify({ joinCode: created.room.joinCode, displayName: 'Editor' }) })).body
  for (const method of ['PATCH', 'DELETE']) {
    const denied = await request(`/api/rooms/${created.room.id}`, { method, headers: headersFor(editor.sessionId, 0), ...(method === 'PATCH' ? { body: JSON.stringify({ name: 'Taken' }) } : {}) })
    assert.equal(denied.response.status, 403)
  }
  assert.equal((await request('/api/rooms', { method: 'POST', body: '{broken' })).response.status, 400)
  assert.equal((await request('/api/unknown')).response.status, 404)
})

test('owner recovery works from another browser and rotating keys revokes older keys', async () => {
  const created = await create('Recoverable room')
  assert.equal(created.recoveryKey.length, 40)
  const join = recoveryKey => request('/api/rooms/join', { method: 'POST', body: JSON.stringify({ joinCode: created.room.joinCode, displayName: 'Recovered', recoveryKey }) })
  assert.equal((await join('incorrect')).response.status, 403)
  assert.equal((await join(created.recoveryKey)).body.participant.role, 'owner')
  const next = await request(`/api/rooms/${created.room.id}/recovery`, { method: 'POST', headers: headersFor(created.sessionId, 0) })
  assert.equal(next.response.status, 200)
  assert.equal((await join(created.recoveryKey)).response.status, 403)
  assert.equal((await join(next.body.recoveryKey)).body.participant.role, 'owner')
  const viewer = (await request('/api/rooms/join', { method: 'POST', body: JSON.stringify({ joinCode: created.room.joinCode, displayName: 'Viewer', role: 'viewer' }) })).body
  assert.equal((await request(`/api/rooms/${created.room.id}/recovery`, { method: 'POST', headers: headersFor(viewer.sessionId, 0) })).response.status, 403)
})

test('CRUD persists complete device/link properties and room deletion revokes sockets', async () => {
  const created = await create('Full CRUD')
  let result = await importGraph(created, { nodes: [device('crud-a'), device('crud-b', 300)], edges: [{ id: 'crud-ab', sourceNodeId: 'crud-a', targetNodeId: 'crud-b', status: 'active' }] })
  const updatedNode = { ...result.body.nodes[0], label: 'Configured', data: { ipv4: '10.1.1.1', cidr: 24, ipv6: '2001:db8::1/64', mac: 'AA:BB:CC:DD:EE:FF', vlan: '10', vendor: 'Test Vendor', notes: 'Notes', status: 'warning' } }
  result = await request(`/api/rooms/${created.room.id}/nodes/crud-a`, { method: 'PATCH', headers: headersFor(created.sessionId, 1), body: JSON.stringify(updatedNode) })
  assert.equal(result.response.status, 200); assert.equal(result.body.node.data.ipv6, '2001:db8::1/64')
  const updatedEdge = { id: 'crud-ab', sourceNodeId: 'crud-a', targetNodeId: 'crud-b', sourceSide: 'left', targetSide: 'right', medium: 'wifi', bandwidth: '866 Mbps', status: 'inactive', label: 'Wi-Fi link', notes: 'Wireless' }
  result = await request(`/api/rooms/${created.room.id}/edges/crud-ab`, { method: 'PATCH', headers: headersFor(created.sessionId, 2), body: JSON.stringify(updatedEdge) })
  assert.equal(result.response.status, 200); assert.equal(result.body.edge.sourceSide, 'left')
  result = await request(`/api/rooms/${created.room.id}/edges/crud-ab`, { method: 'DELETE', headers: headersFor(created.sessionId, 3) })
  assert.equal(result.response.status, 200); assert.equal(result.body.room.revision, 4)
  const connection = await socketFor(created)
  try {
    const disconnected = new Promise(resolve => connection.socket.once('disconnect', resolve))
    assert.equal((await request(`/api/rooms/${created.room.id}`, { method: 'DELETE', headers: headersFor(created.sessionId, 4) })).response.status, 204)
    await disconnected
    assert.equal((await request(`/api/rooms/${created.room.id}`, { headers: headersFor(created.sessionId, 4) })).response.status, 401)
  } finally { connection.socket.disconnect() }
})
test('malformed socket authentication is rejected without crashing the server', async () => {
  const created = await create()
  for (const auth of [{ roomId: created.room.id, sessionId: {} }, { roomId: {}, sessionId: created.sessionId }]) {
    const socket = connectSocket(baseUrl(), { auth, transports: ['websocket'], reconnection: false })
    try { await new Promise((resolve, reject) => { socket.once('connect_error', resolve); socket.once('connect', () => reject(new Error('Malformed auth accepted'))) }) }
    finally { socket.disconnect() }
  }
  assert.equal((await request('/api/health')).body.ok, true)
})
test('room capacity, foreign edge endpoints and payload size are enforced', async () => {
  const created = await create('Capacity')
  assert.equal((await importGraph(created, { nodes: Array.from({ length: 500 }, (_, index) => device(`capacity-${index}`, index * 10)), edges: [] })).response.status, 200)
  assert.equal((await request(`/api/rooms/${created.room.id}/nodes`, { method: 'POST', headers: headersFor(created.sessionId, 1), body: JSON.stringify(device('over-capacity')) })).body.error, 'ROOM_CAPACITY')
  const foreign = await create('Foreign')
  const foreignNode = (await request(`/api/rooms/${foreign.room.id}/nodes`, { method: 'POST', headers: headersFor(foreign.sessionId, 0), body: JSON.stringify(device('foreign-node')) })).body.node
  const invalid = await request(`/api/rooms/${created.room.id}/edges`, { method: 'POST', headers: headersFor(created.sessionId, 1), body: JSON.stringify({ sourceNodeId: 'capacity-0', targetNodeId: foreignNode.id }) })
  assert.equal(invalid.body.error, 'INVALID_EDGE_ENDPOINT')
  const oversized = await request(`/api/rooms/${created.room.id}/topology/import`, { method: 'POST', headers: headersFor(created.sessionId, 1), body: JSON.stringify({ notes: 'x'.repeat(1024 * 1024), nodes: [], edges: [] }) })
  assert.equal(oversized.response.status, 413)
  assert.equal((await request(`/api/rooms/${created.room.id}`, { headers: headersFor(created.sessionId, 1) })).body.room.revision, 1)
})
test('expired room sessions cannot access data and can recover owner access with a recovery key', async () => {
  const created = await create('Expired')
  db.prepare('UPDATE room_access SET expires_at = 0 WHERE room_id = ?').run(created.room.id)
  assert.equal((await request(`/api/rooms/${created.room.id}`, { headers: headersFor(created.sessionId, 0) })).response.status, 401)
  const recovered = await request('/api/rooms/join', { method: 'POST', body: JSON.stringify({ joinCode: created.room.joinCode, displayName: 'Recovered owner', recoveryKey: created.recoveryKey }) })
  assert.equal(recovered.body.participant.role, 'owner')
})
