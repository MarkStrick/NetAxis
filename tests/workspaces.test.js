import { captchaFetch as fetch } from './helpers/captcha.js'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { presetProjects, scenarioTopology } from '../src/shared/templates.js'
import { buildPdu } from '../src/client/lib/simulator.js'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-workspaces-'))
process.env.DATA_DIR = directory; process.env.PORT = '0'; process.env.NODE_ENV = 'test'; process.env.PUBLIC_ORIGIN = ''
const { httpServer, closeServer } = await import('../src/server/index.js')
const { db } = await import('../src/server/db.js')
if (!httpServer.listening) await new Promise(resolve => httpServer.once('listening', resolve))
const base = `http://127.0.0.1:${httpServer.address().port}`
after(async () => { await closeServer(); fs.rmSync(directory, { recursive: true, force: true }) })
async function request(url, method = 'GET', body, token, extra = {}) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-session-id': token } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: res.status, body: res.status === 204 ? null : await res.json() }
}
async function create(templateId) {
  const result = await request('/api/rooms', 'POST', { name: 'Backup test', displayName: 'Owner', templateId })
  assert.equal(result.status, 201); return result.body
}
test('all templates round-trip through a complete workspace with independent IDs and working scenarios', async () => {
  for (const preset of presetProjects) {
    const owner = await create(preset.id), root = `/api/rooms/${owner.room.id}`
    const exported = await request(root + '/export', 'GET', null, owner.sessionId)
    assert.equal(exported.status, 200)
    const archive = exported.body, text = JSON.stringify(archive)
    for (const secret of [owner.sessionId, owner.recoveryKey, owner.room.id, owner.room.joinCode, 'createdBy', 'token_hash']) assert.equal(text.includes(secret), false, secret)
    const restored = await request('/api/rooms/restore', 'POST', { workspace: { ...archive, expiresAt: 1 }, displayName: 'Restored owner' })
    assert.equal(restored.status, 201, JSON.stringify(restored.body))
    const copy = restored.body, copiedRoot = `/api/rooms/${copy.room.id}`
    assert.equal(copy.participant.role, 'owner')
    assert.notEqual(copy.room.id, owner.room.id)
    assert.notEqual(copy.room.joinCode, owner.room.joinCode)
    assert.equal(Date.parse(copy.room.expiresAt) - Date.parse(copy.room.createdAt), 24 * 60 * 60 * 1000)
    const originalIds = new Set([...archive.nodes, ...archive.edges].map(n => n.id))
    assert.ok([...copy.topology.nodes, ...copy.topology.edges].every(n => !originalIds.has(n.id)))
    assert.deepEqual(copy.topology.nodes.map(n => n.data), archive.nodes.map(n => n.data))
    const planning = await request(copiedRoot + '/planning', 'GET', null, copy.sessionId)
    assert.deepEqual(planning.body.plan.input, archive.plan)
    assert.deepEqual(planning.body.plan.design.issues, [])
    for (const scenario of copy.topology.template.scenarios) assert.equal(buildPdu(scenarioTopology(copy.topology, scenario), scenario).outcome, scenario.expected, scenario.name)
    assert.deepEqual((await request(root + '/export', 'GET', null, owner.sessionId)).body.nodes, archive.nodes)
    // The original can expire without affecting the independently restored room.
    db.prepare('UPDATE rooms SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), owner.room.id)
    assert.equal((await request(root + '/export', 'GET', null, owner.sessionId)).status, 410)
    assert.equal((await request(copiedRoot, 'GET', null, copy.sessionId)).status, 200)
  }
})
test('export enforces room membership and supports empty rooms without a plan/template', async () => {
  const owner = await create(), other = await create(), root = `/api/rooms/${owner.room.id}/export`
  assert.equal((await request(root)).status, 401)
  assert.equal((await request(root, 'GET', null, other.sessionId)).status, 401)
  const archive = (await request(root, 'GET', null, owner.sessionId)).body
  assert.equal(archive.plan, null); assert.equal(archive.template, null)
  const result = await request('/api/rooms/restore', 'POST', { workspace: archive, displayName: 'Owner' })
  assert.equal(result.status, 201); assert.deepEqual(result.body.topology.nodes, [])
})
test('invalid backups are rejected atomically without creating rooms or memberships', async () => {
  const owner = await create('office-lan')
  const archive = (await request(`/api/rooms/${owner.room.id}/export`, 'GET', null, owner.sessionId)).body
  const snapshot = () => ['rooms', 'room_access', 'nodes', 'edges', 'ip_plans', 'room_templates'].map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n)
  const before = snapshot()
  const corruptions = [a => { a.version = 999 }, a => { a.nodes.push(a.nodes[0]) }, a => { a.edges[0].sourceNodeId = 'missing' }, a => { a.nodes[0].data.ipv4 = a.nodes[1].data.ipv4 }, a => { a.plan.segments[0].hosts = -1 }]
  for (const corrupt of corruptions) {
    const broken = structuredClone(archive); corrupt(broken)
    const result = await request('/api/rooms/restore', 'POST', { workspace: broken, displayName: 'Owner' })
    assert.equal(result.status, 400); assert.deepEqual(snapshot(), before)
  }
})
test('topology Undo/Redo import keeps saved template scenarios available', async () => {
  const owner = await create('branch-hq'), root = `/api/rooms/${owner.room.id}`
  const imported = await request(root + '/topology/import', 'POST', { nodes: owner.topology.nodes, edges: owner.topology.edges }, owner.sessionId, { 'x-topology-revision': '1' })
  assert.equal(imported.status, 200)
  assert.deepEqual(imported.body.template, owner.topology.template)
})
