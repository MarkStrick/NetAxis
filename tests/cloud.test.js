import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { CloudStore } from '../src/server/cloud/store.js'
import { presetProjects } from '../src/shared/templates.js'
process.env.NODE_ENV = 'test'; process.env.PUBLIC_ORIGIN = ''; process.env.VERCEL = ''
const { createCloudApp } = await import('../src/server/cloud/app.js')
const { createHandler } = await import('../api/index.js')
const { createServer } = await import('node:http')
const db = new PGlite({ initialMemory: 128 * 1024 * 1024 })
await db.waitReady
const driver = { query: (q, v) => db.query(q, v), transaction: fn => db.transaction(fn) }
const stores = [new CloudStore(driver), new CloudStore(driver)]
const servers = stores.map(store => createServer(createHandler(() => createCloudApp(store))).listen(0, '127.0.0.1'))
await Promise.all(servers.map(server => new Promise(resolve => server.once('listening', resolve))))
after(async () => { await Promise.all(servers.map(server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })); await db.close() })
async function request(url, method = 'GET', body, token, instance = 0, extra = {}) {
  // Second instance receives the internal Vercel rewrite, first gets original URL.
  const path = instance === 1 ? '/api?__path=' + encodeURIComponent(url.slice(1)) : '/api' + url
  const response = await fetch(`http://127.0.0.1:${servers[instance].address().port}` + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-session-id': token } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers }
}
const create = async (templateId) => { const r = await request('/rooms', 'POST', { name: 'Cloud test', displayName: 'Owner', ...(templateId ? { templateId } : {}) }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body }
const node = { id: 'test-node', type: 'pc', label: 'PC', position: { x: 10, y: 20 }, data: { ipv4: '10.0.0.10', cidr: 24 } }
const input = { parent: '10.44.0.0/24', segments: [{ id: 'hq', name: 'HQ', vlan: 10, hosts: 50, growth: 0, reservedCount: 2 }], assignments: [{ segmentId: 'hq', ip: '10.44.0.10', kind: 'server' }, { segmentId: 'hq', ip: '10.44.0.2', kind: 'reserved', mac: '11:22:33:44:55:66' }] }

test('Postgres templates, private room listing and backup/restore survive independent API instances', async () => {
  for (const preset of presetProjects) {
    const owner = await create(preset.id), root = '/rooms/' + owner.room.id
    assert.equal(Date.parse(owner.room.expiresAt) - Date.parse(owner.room.createdAt), 86400000)
    const loaded = await request(root, 'GET', undefined, owner.sessionId, 1)
    assert.deepEqual(loaded.body, owner.topology)
    assert.equal(loaded.headers.get('cache-control'), 'no-store')
    assert.equal((await request('/rooms', 'GET', undefined, owner.sessionId, 1)).body.rooms[0].id, owner.room.id)
    const resumed = await request('/session', 'GET', undefined, undefined, 1, { cookie: `netaxis-room=${owner.room.id}; netaxis-session=${owner.sessionId}` })
    assert.equal(resumed.body.participant.role, 'owner')
    assert.equal(resumed.body.room.id, owner.room.id)
    assert.deepEqual((await request('/rooms')).body.rooms, [])
    const backup = (await request(root + '/export', 'GET', undefined, owner.sessionId, 1)).body
    assert.ok(backup.plan); assert.ok(backup.template.scenarios.length)
    assert.equal(JSON.stringify(backup).includes(owner.recoveryKey), false)
    const restored = await request('/rooms/restore', 'POST', { workspace: backup, displayName: 'Restored' })
    assert.equal(restored.status, 201, JSON.stringify(restored.body))
    assert.equal(restored.body.topology.nodes.length, owner.topology.nodes.length)
    assert.ok(restored.body.topology.nodes.every(n => !owner.topology.nodes.some(old => old.id === n.id)))
    const plan = await request('/rooms/' + restored.body.room.id + '/planning', 'GET', undefined, restored.body.sessionId, 1)
    assert.deepEqual(plan.body.plan.input, backup.plan)
  }
  const before = (await db.query('SELECT count(*)::int AS n FROM netaxis_cloud_rooms')).rows[0].n
  assert.equal((await request('/rooms', 'POST', { name: 'Bad', displayName: 'Owner', templateId: 'missing' })).status, 400)
  assert.equal((await request('/rooms/restore', 'POST', { workspace: {}, displayName: 'Owner' })).status, 400)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM netaxis_cloud_rooms')).rows[0].n, before)
})

test('missing cloud database returns an actionable non-cacheable error', async () => {
  const server = createServer(createHandler(() => { throw new Error('Not configured') })).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/health`)
    assert.equal(result.status, 503)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.equal((await result.json()).error, 'DATABASE_NOT_CONFIGURED')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('Vercel production accepts only its exact deployment and production origins', async () => {
  const { execFileSync } = await import('node:child_process')
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { originAllowed, production } from './src/server/lib/security.js';
    assert.equal(production, true);
    for (const origin of ['https://netaxis.vercel.app','https://netaxis-preview-abc.vercel.app']) assert.equal(originAllowed(origin, {}),true);
    for (const origin of ['https://evil.vercel.app','https://netaxis.vercel.app.evil.com','http://netaxis.vercel.app']) assert.equal(originAllowed(origin, {}),false);
  `], { env: { ...process.env, NODE_ENV: 'production', PUBLIC_ORIGIN: '', VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'netaxis.vercel.app', VERCEL_URL: 'netaxis-preview-abc.vercel.app' }, windowsHide: true })
})

test('concurrent edits reject stale revisions and invalid edits roll back without losing topology', async () => {
  const owner = await create(), root = '/rooms/' + owner.room.id, token = owner.sessionId
  assert.equal((await request(root)).status, 401)
  const results = await Promise.all([0, 1].map(i => request(root + '/nodes', 'POST', { ...node, id: 'node-' + i }, token, i, { 'x-topology-revision': '0' })))
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409])
  const saved = (await request(root, 'GET', undefined, token, 1)).body
  assert.equal(saved.nodes.length, 1); assert.equal(saved.room.revision, 1)
  assert.equal((await request(root + '/nodes', 'POST', node, token, 1, { 'x-topology-revision': '1' })).status, 400)
  assert.equal((await request(root + '/edges', 'POST', { sourceNodeId: saved.nodes[0].id, targetNodeId: 'absent' }, token, 1, { 'x-topology-revision': '1' })).status, 400)
  assert.equal((await request(root + '/nodes', 'POST', { ...node, data: {} }, token)).status, 409)
  assert.deepEqual((await request(root, 'GET', undefined, token)).body, saved)
  const imported = await request(root + '/topology/import', 'POST', { nodes: [], edges: [] }, token, 1, { 'x-topology-revision': '1' })
  assert.equal(imported.status, 200); assert.equal(imported.body.room.revision, 2)
  const sync = await request(root + '/sync', 'POST', { revision: 1, tabId: 'owner-tab' }, token)
  assert.deepEqual(sync.body.topology.nodes, [])
  assert.equal((await request(root + '/sync', 'POST', { revision: 2, tabId: 'owner-tab' }, token)).body.topology, undefined)
})

test('roles, owner recovery, multiple tabs and deletion work across instances', async () => {
  const owner = await create(), root = '/rooms/' + owner.room.id
  const joined = await request('/rooms/join', 'POST', { joinCode: owner.room.joinCode, displayName: 'Editor', role: 'editor' }, undefined, 1)
  const token = joined.body.sessionId
  for (const tabId of ['a', 'b']) assert.equal((await request(root + '/sync', 'POST', { revision: 0, tabId }, token, 1)).status, 200)
  assert.equal((await request(root + '/presence', 'GET', undefined, owner.sessionId)).body.participants.length, 1)
  await request('/session/leave', 'POST', { tabId: 'a' }, token, 0, { cookie: 'netaxis-room=' + owner.room.id })
  assert.equal((await request(root + '/presence', 'GET', undefined, owner.sessionId)).body.participants.length, 1)
  await request(root, 'PATCH', { accessMode: 'viewer' }, owner.sessionId)
  assert.equal((await request(root + '/sync', 'POST', { revision: 0, tabId: 'b' }, token, 1)).body.participant.role, 'viewer')
  assert.equal((await request(root + '/nodes', 'POST', node, token, 1, { 'x-topology-revision': '0' })).status, 403)
  const rotated = await request(root + '/recovery', 'POST', {}, owner.sessionId)
  assert.equal((await request('/rooms/join', 'POST', { joinCode: owner.room.joinCode, displayName: 'Recovery', recoveryKey: owner.recoveryKey })).status, 403)
  const recovery = await request('/rooms/join', 'POST', { joinCode: owner.room.joinCode, displayName: 'Recovery', recoveryKey: rotated.body.recoveryKey }, undefined, 1)
  assert.equal(recovery.body.participant.role, 'owner')
  assert.equal((await request(root, 'DELETE', undefined, recovery.body.sessionId, 1)).status, 204)
  assert.equal((await request(root, 'GET', undefined, owner.sessionId)).status, 404)
  assert.equal((await db.query('SELECT * FROM netaxis_cloud_presence WHERE room_id=$1', [owner.room.id])).rows.length, 0)
})

test('planning, probe leasing, complete reports and expiry use durable Postgres state', async () => {
  const owner = await create(), root = '/rooms/' + owner.room.id, planRoot = root + '/planning', token = owner.sessionId
  assert.equal((await request(planRoot, 'PUT', { input, revision: 0 }, token)).status, 200)
  assert.equal((await request(planRoot, 'PUT', { input, revision: 0 }, token, 1)).status, 409)
  assert.equal((await request(planRoot + '/scale', 'POST', { input, changes: { hq: 150 } }, token)).body.comparison[0].oldSubnetInsufficient, true)
  const enrolled = await request(planRoot + '/probes', 'POST', { name: 'HQ', segmentId: 'hq' }, token, 1)
  assert.equal(enrolled.status, 201, JSON.stringify(enrolled.body))
  const probe = enrolled.body, queue = planRoot + '/probes/' + probe.id + '/jobs', agent = '/probes/' + probe.id + '/jobs', auth = { Authorization: 'Bearer ' + probe.token }
  assert.equal((await request(queue, 'POST', { kind: 'host', target: '8.8.8.8' }, token)).status, 400)
  assert.equal((await request(queue, 'POST', { kind: 'scan' }, token)).status, 201)
  const leases = await Promise.all([0, 1].map(i => request(agent, 'GET', undefined, undefined, i, auth)))
  const jobs = leases.map(r => r.body.job).filter(Boolean); assert.equal(jobs.length, 1)
  const job = jobs[0], resultUrl = agent + '/' + job.id + '/result'
  const report = { lease: job.lease, observations: job.targets.map(ip => ({ ip, reachable: ['10.44.0.2', '10.44.0.20'].includes(ip), mac: ip === '10.44.0.2' ? 'aa:bb:cc:dd:ee:ff' : '' })) }
  assert.equal((await request(resultUrl, 'POST', { ...report, observations: [] }, undefined, 0, auth)).status, 400)
  for (const i of [1, 0]) assert.equal((await request(resultUrl, 'POST', report, undefined, i, auth)).status, 200)
  const verified = await request(planRoot + '/verification', 'GET', undefined, token, 1)
  for (const code of ['UNEXPECTED_DEVICE', 'MISSING_UNREACHABLE', 'RESERVED_CONFLICT', 'MAC_MISMATCH']) assert.ok(verified.body.comparison.findings.some(f => f.code === code), code)
  assert.equal((await request(planRoot + '/probes', 'GET', undefined, token)).body.probes[0].tokenHash, undefined)
  await stores[1].transaction(async client => { const s = await stores[1].find('id', owner.room.id, client, true); s.room.expiresAt = new Date(Date.now() - 1).toISOString(); await stores[1].save(s, client) })
  assert.equal((await request(root, 'GET', undefined, token)).status, 410)
  assert.equal((await request(agent, 'GET', undefined, undefined, 1, auth)).status, 410)
  assert.deepEqual((await request('/rooms', 'GET', undefined, token)).body.rooms, [])
})


test('shared Simulator persists across API instances and unchanged-topology polling, with one controller and atomic commands', async () => {
  const owner = await create(presetProjects[0].id), root = '/rooms/' + owner.room.id, revision = owner.room.revision
  const join = async role => (await request('/rooms/join', 'POST', { joinCode: owner.room.joinCode, displayName: role, role }, undefined, 1)).body
  const runner = await join('editor'), viewer = await join('viewer'), other = await join('editor')
  const scenario = owner.topology.template.scenarios[0]
  const input = { action: 'run', revision: 0, topologyRevision: revision, autoplay: true, request: { source: scenario.source, target: scenario.target, protocol: 'ICMP', ttl: 64, destinationPort: 80, payloadBytes: 32, scenarioId: scenario.id } }
  const result = await request(root + '/simulation', 'POST', input, runner.sessionId)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.simulation.controller.id, runner.participant.id)
  const sync = await request(root + '/sync', 'POST', { revision, tabId: 'viewer' }, viewer.sessionId, 1)
  assert.equal(sync.body.topology, undefined)
  assert.equal(sync.body.simulation.runId, result.body.simulation.runId)
  const late = await join('viewer'); assert.equal(late.topology.simulation.runId, result.body.simulation.runId)
  assert.equal((await request(root + '/simulation', 'POST', { ...input, action: 'pause', revision: 1 }, viewer.sessionId)).status, 403)
  assert.equal((await request(root + '/simulation', 'POST', { ...input, action: 'pause', revision: 1 }, other.sessionId)).status, 403)
  const paused = await request(root + '/simulation', 'POST', { ...input, action: 'pause', revision: 1 }, runner.sessionId, 1)
  assert.equal(paused.status, 200)
  const snapshot = (await request(root, 'GET', undefined, viewer.sessionId)).body.simulation
  assert.equal(snapshot.status, 'paused'); assert.equal(snapshot.position, paused.body.simulation.position)
  const commands = await Promise.all([0,1].map(i => request(root + '/simulation', 'POST', { ...input, action: 'resume', revision: 2 }, runner.sessionId, i)))
  assert.deepEqual(commands.map(r => r.status).sort(), [200, 409])
  assert.equal((await request(root + '/export', 'GET', undefined, owner.sessionId)).body.simulation, undefined)
  assert.equal((await request(root + '/simulation', 'POST', { ...input, action: 'stop', revision: 3 }, owner.sessionId)).status, 200)
  assert.equal((await request(root, 'GET', undefined, viewer.sessionId, 1)).body.simulation.request, null)
  const rerun = await request(root + '/simulation', 'POST', { ...input, revision: 4 }, runner.sessionId)
  assert.equal(rerun.status, 200)
  await request(root + '/topology/import', 'POST', { nodes: [], edges: [] }, owner.sessionId, 1, { 'x-topology-revision': String(revision) })
  assert.equal((await request(root, 'GET', undefined, viewer.sessionId)).body.simulation.request, null)
})
