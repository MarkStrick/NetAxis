import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { presetProjects } from '../src/shared/templates.js'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-templates-'))
process.env.DATA_DIR = directory; process.env.PORT = '0'; process.env.NODE_ENV = 'test'; process.env.PUBLIC_ORIGIN = ''
const { httpServer, closeServer } = await import('../src/server/index.js')
const { db, createRoom } = await import('../src/server/db.js')
const { installTemplate } = await import('../src/server/templates.js')
if (!httpServer.listening) await new Promise(resolve => httpServer.once('listening', resolve))
const base = `http://127.0.0.1:${httpServer.address().port}`
after(async () => { await closeServer(); fs.rmSync(directory, { recursive: true, force: true }) })
async function request(url, method = 'GET', body, headers = {}) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: res.status, body: res.status === 204 ? null : await res.json() }
}
test('templates are created with persisted IPAM/scenarios and independent IDs in a single request', async () => {
  const allIds = new Set()
  for (const preset of presetProjects) {
    const result = await request('/api/rooms', 'POST', { name: preset.name, displayName: 'Owner', templateId: preset.id })
    assert.equal(result.status, 201)
    const owner = result.body, headers = { 'x-session-id': owner.sessionId }, root = `/api/rooms/${owner.room.id}`
    assert.equal(owner.room.revision, 1)
    assert.equal(owner.topology.nodes.length, preset.nodes.length)
    assert.equal(owner.topology.edges.length, preset.edges.length)
    assert.equal(owner.topology.template.mode, 'Realtime')
    for (const item of [...owner.topology.nodes, ...owner.topology.edges]) { assert.equal(allIds.has(item.id), false); allIds.add(item.id) }
    const restored = await request(root, 'GET', null, headers)
    assert.deepEqual(restored.body.template, owner.topology.template)
    const plan = (await request(root + '/planning', 'GET', null, headers)).body.plan
    assert.equal(plan.revision, 1)
    assert.equal(plan.input.parent, preset.plan.parent)
    assert.deepEqual(plan.design.issues, [])
    assert.equal((await request(root + '/planning')).status, 401)
    const viewer = (await request('/api/rooms/join', 'POST', { joinCode: owner.room.joinCode, displayName: 'Viewer', role: 'viewer' })).body
    assert.deepEqual(viewer.topology.template, owner.topology.template)
    assert.equal((await request(root + '/planning', 'PUT', { input: plan.input, revision: 1 }, { 'x-session-id': viewer.sessionId })).status, 403)
  }
})
test('unknown templates do not leave empty rooms or sessions', async () => {
  const count = () => db.prepare('SELECT count(*) AS n FROM rooms').get().n
  const before = count()
  assert.equal((await request('/api/rooms', 'POST', { name: 'Invalid', displayName: 'Owner', templateId: 'missing' })).status, 400)
  assert.equal(count(), before)
})
test('a failed template installation rolls back the new room and topology', () => {
  const before = db.prepare('SELECT count(*) AS n FROM rooms').get().n
  const invalid = structuredClone(presetProjects[0])
  invalid.plan.segments[0].hosts = 500
  assert.throws(db.transaction(() => {
    const room = createRoom({ name: 'Invalid installation' })
    installTemplate(room.id, invalid, 'test-actor')
  }), /failed validation/)
  assert.equal(db.prepare('SELECT count(*) AS n FROM rooms').get().n, before)
})
