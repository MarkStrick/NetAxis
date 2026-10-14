import {randomBytes} from 'node:crypto'
import {passwordHash} from '../src/server/lib/accounts.js'
import {hash,sessionLifetime} from '../src/server/lib/security.js'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { CloudStore } from '../src/server/cloud/store.js'
import { captchaDigest } from '../src/server/lib/captcha.js'
import { DEFAULT_ROOM_NAME } from '../src/shared/room-defaults.js'
process.env.ROOM_ENTRY_LIMIT = '1000'
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
const accountCookies=new Map();let fixturePassword
async function cloudAccount(){
 await stores[0].init();fixturePassword ||= passwordHash('Fixture-password-123!')
 const id='account_'+randomBytes(16).toString('hex'),session=randomBytes(32).toString('hex')
 await db.query('INSERT INTO netaxis_accounts VALUES ($1,$2,$3,$4)',[id,id+'@example.test',await fixturePassword,randomBytes(32).toString('hex')])
 await db.query('INSERT INTO netaxis_account_sessions VALUES ($1,$2,$3)',[hash(session),id,Date.now()+sessionLifetime])
 const cookie='netaxis-account='+session;accountCookies.set(id,cookie);return {id,cookie}
}
async function request(url, method = 'GET', body, token, instance = 0, extra = {}, autoCaptcha = true) {
  extra={...extra}
  const identifier=token || extra.cookie?.match(/netaxis-session=([^;]+)/)?.[1]
  if(!extra.cookie?.includes('netaxis-account=')){
    const cookie=accountCookies.get(identifier) || (autoCaptcha && method==='POST' && ['/rooms','/rooms/join','/rooms/restore'].includes(url)?(await cloudAccount()).cookie:'')
    if(cookie)extra.cookie=[extra.cookie,cookie].filter(Boolean).join('; ')
  }

  if (autoCaptcha && method === 'POST' && ['/rooms', '/rooms/join', '/rooms/restore'].includes(url) && !body?.captcha) {
    const challenge = await request('/captcha', 'GET', undefined, token, instance, extra)
    const answer = '123456'
    await db.query('UPDATE netaxis_cloud_captcha SET answer_hash=$1 WHERE id=$2', [captchaDigest(challenge.body.id, answer), challenge.body.id])
    extra = { ...extra, cookie: [extra.cookie, challenge.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')].filter(Boolean).join('; ') }
    const verification = await request('/captcha/verify', 'POST', { captcha: { id: challenge.body.id, answer } }, token, instance, extra)
    assert.equal(verification.status, 200)
    extra.cookie += '; ' + verification.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  }
  // Second instance receives the internal Vercel rewrite, first gets original URL.
  const path = instance === 1 ? '/api?__path=' + encodeURIComponent(url.slice(1)) : '/api' + url
  const response = await fetch(`http://127.0.0.1:${servers[instance].address().port}` + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-session-id': token } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers }
}
const create = async (templateId) => { const r = await request('/rooms', 'POST', { name: 'Cloud test', displayName: 'Owner', ...(templateId ? { templateId } : {}) }); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.match(r.body.room.joinCode, /^\d{4}$/); return r.body }
test('cloud room creation retries a duplicate four-digit code', async () => {
  const owner = await create()
  const state = structuredClone(await stores[0].find('id', owner.room.id))
  state.room.id = 'room_duplicate_code_test'
  await stores[0].transaction(client => stores[0].save(state, client, true))
  assert.match(state.room.joinCode, /^\d{4}$/)
  assert.notEqual(state.room.joinCode, owner.room.joinCode)
  assert.equal((await stores[1].find('code', state.room.joinCode)).room.id, state.room.id)
})
test('cloud startup converts existing long codes and preserves room data', async () => {
  const owner = await create()
  await db.query("UPDATE netaxis_cloud_rooms SET join_code='LEGACY1234', state=jsonb_set(state, '{room,joinCode}', '\"LEGACY1234\"'::jsonb) WHERE id=$1", [owner.room.id])
  const upgraded = new CloudStore(driver)
  const state = await upgraded.find('id', owner.room.id)
  assert.match(state.room.joinCode, /^\d{4}$/)
  assert.equal(state.room.name, owner.room.name)
  assert.equal((await upgraded.find('code', state.room.joinCode)).room.id, owner.room.id)
})
test('cloud creation persists the default name for omitted and blank names', async () => {
  for (const fields of [{}, { name: '  ' }]) {
    const result = await request('/rooms', 'POST', { ...fields, displayName: 'Owner' })
    assert.equal(result.status, 201)
    const restored = await request('/rooms/' + result.body.room.id + '/resume', 'POST', undefined, result.body.sessionId, 1)
    assert.equal(restored.body.room.name, DEFAULT_ROOM_NAME)
  }
})
const node = { id: 'test-node', type: 'pc', label: 'PC', position: { x: 10, y: 20 }, data: { ipv4: '10.0.0.10', cidr: 24 } }
const input = { parent: '10.44.0.0/24', segments: [{ id: 'hq', name: 'HQ', vlan: 10, hosts: 50, growth: 0, reservedCount: 2 }], assignments: [{ segmentId: 'hq', ip: '10.44.0.10', kind: 'server' }, { segmentId: 'hq', ip: '10.44.0.2', kind: 'reserved', mac: '11:22:33:44:55:66' }] }

test('cloud collaboration previews and private voice signaling survive instance changes without topology revisions', async () => {
  const owner = await create('cisco-lan-demo'), root = `/rooms/${owner.room.id}`
  const viewer = (await request('/rooms/join','POST',{joinCode:owner.room.joinCode,displayName:'Voice viewer',role:'viewer'})).body
  const revision = owner.topology.room.revision, nodeId = owner.topology.nodes[0].id
  const moved = await request(root + '/collaboration','POST',{action:'move',nodeId,position:{x:77,y:88},revision},owner.sessionId)
  assert.equal(moved.status,200)
  assert.equal((await request(root + '/collaboration','GET',undefined,viewer.sessionId,1)).body.moves[0].position.x,77)
  assert.equal((await request(root + '/collaboration','POST',{action:'move',nodeId,position:{x:1,y:2},revision},viewer.sessionId,1)).status,403)
  for (const token of [owner.sessionId,viewer.sessionId]) assert.equal((await request(root + '/collaboration','POST',{action:'voice-join'},token)).status,200)
  assert.equal((await request(root + '/collaboration','POST',{action:'voice-signal',target:viewer.participant.id,kind:'offer',sdp:'fixture offer'},owner.sessionId,1)).status,200)
  const peer = await request(root + '/collaboration','GET',undefined,viewer.sessionId,1)
  assert.equal(peer.body.signals[0].sdp,'fixture offer')
  assert.equal((await request(root + '/collaboration','GET',undefined,owner.sessionId)).body.signals.length,0)
  const archive = await request(root + '/export','GET',undefined,owner.sessionId,1)
  assert.equal(archive.body.collaboration,undefined); assert.ok(archive.body.edges.every(e => e.sourcePort && e.targetPort))
  assert.equal((await request(root,'GET',undefined,owner.sessionId)).body.room.revision,revision)
})

test('first-visit captcha is remembered across Cloud instances and consumed exactly once', async () => {
  for (const url of ['/rooms', '/rooms/join', '/rooms/restore']) assert.equal((await request(url, 'POST', {}, undefined, 0, {}, false)).body.error, 'LOGIN_REQUIRED')
  const challenge = await request('/captcha'), answer = '123456'
  await db.query('UPDATE netaxis_cloud_captcha SET answer_hash=$1 WHERE id=$2', [captchaDigest(challenge.body.id, answer), challenge.body.id])
  const cookie = challenge.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const payload = { captcha: { id: challenge.body.id, answer } }
  assert.equal((await request('/captcha/verify', 'POST', payload, undefined, 1, { cookie: 'netaxis-captcha=foreign' })).body.error, 'CAPTCHA_INVALID')
  const results = await Promise.all([0, 1].map(instance => request('/captcha/verify', 'POST', payload, undefined, instance, { cookie })))
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400])
  const verifiedCookie = (await cloudAccount()).cookie+'; '+results.find(result => result.status === 200).headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.equal((await request('/visitor', 'GET', undefined, undefined, 1, { cookie: verifiedCookie })).body.verified, true)
  for (const instance of [0, 1]) assert.equal((await request('/rooms', 'POST', { name: 'No repeated captcha', displayName: 'Owner' }, undefined, instance, { cookie: verifiedCookie }, false)).status, 201)
  const expired = await request('/captcha', 'GET', undefined, undefined, 1)
  await db.query('UPDATE netaxis_cloud_captcha SET expires_at=0 WHERE id=$1', [expired.body.id])
  assert.equal((await request('/captcha/verify', 'POST', { captcha: { id: expired.body.id, answer } }, undefined, 0, { cookie: expired.headers.getSetCookie().map(v => v.split(';')[0]).join('; ') })).body.error, 'CAPTCHA_INVALID')
})

test('chat and member statuses persist across Cloud instances without topology edits', async () => {
  const owner = await create(), root = '/rooms/' + owner.room.id, other = await create()
  const viewer = (await request('/rooms/join', 'POST', { joinCode: owner.room.joinCode, displayName: 'Viewer', role: 'viewer' })).body
  assert.equal((await request(root + '/messages')).status, 401)
  assert.equal((await request(root + '/messages', 'GET', undefined, other.sessionId, 1)).status, 401)
  const payload = { text: '  ทีมพร้อมแล้ว\n<script>text only</script>  ', clientId: 'cross-instance-message', displayName: 'Spoofed' }
  const results = await Promise.all([0, 1].map(instance => request(root + '/messages', 'POST', payload, viewer.sessionId, instance)))
  assert.deepEqual(results.map(result => result.status), [201, 201]); assert.deepEqual(results[0].body, results[1].body)
  assert.equal(results[0].body.message.displayName, 'Viewer'); assert.equal(results[0].body.message.role, 'viewer')
  assert.equal((await request(root + '/messages', 'POST', { text: 'spam', clientId: 'rate-limited-message' }, viewer.sessionId, 1)).status, 429)
  assert.equal((await request(root + '/messages', 'POST', { text: '', clientId: 'empty-message' }, owner.sessionId, 1)).status, 400)
  const sync = await request(root + '/sync', 'POST', { revision: 0, chatCursor: 0, tabId: 'owner-tab' }, owner.sessionId, 1)
  assert.equal(sync.body.chat.messages.length, 1); assert.equal(sync.body.topology, undefined)
  const next = await request(root + '/sync', 'POST', { revision: 0, chatCursor: sync.body.chat.cursor, tabId: 'owner-tab' }, owner.sessionId, 0)
  assert.deepEqual(next.body.chat.messages, [])
  await request(root + '/sync', 'POST', { revision: 0, tabId: 'viewer-tab' }, viewer.sessionId, 0)
  await request(root + '/member-status', 'PATCH', { status: 'away' }, viewer.sessionId, 1)
  const members = (await request(root + '/presence', 'GET', undefined, owner.sessionId, 0)).body.participants
  assert.equal(members.find(m => m.id === viewer.participant.id).status, 'away')
  await db.query('UPDATE netaxis_cloud_presence SET seen_at=0 WHERE room_id=$1 AND participant_id=$2', [owner.room.id, viewer.participant.id])
  const offline = (await request(root + '/presence', 'GET', undefined, owner.sessionId, 1)).body.participants
  assert.equal(offline.length, 2); assert.equal(offline.find(m => m.id === viewer.participant.id).status, 'offline')
  await stores[0].transaction(async client => {
    const s = await stores[0].find('id', owner.room.id, client, true)
    s.messages = Array.from({ length: 100 }, (_, i) => ({ ...results[0].body.message, id: i + 1, text: `history ${i}`, clientId: `old-message-${i}` }))
    s.chatSequence = 100; await stores[0].save(s, client)
  })
  assert.equal((await request(root + '/messages', 'POST', { text: 'latest', clientId: 'retention-new-message' }, owner.sessionId, 1)).status, 201)
  const history = (await request(root + '/messages', 'GET', undefined, owner.sessionId, 0)).body
  assert.equal(history.messages.length, 100); assert.equal(history.messages[0].text, 'history 1'); assert.equal(history.messages.at(-1).id, 101)
  assert.equal((await request(root, 'GET', undefined, owner.sessionId, 1)).body.room.revision, 0)
})

test('Postgres templates, private room listing and backup/restore survive independent API instances', async () => {
  for (const preset of presetProjects) {
    const owner = await create(preset.id), root = '/rooms/' + owner.room.id
    assert.equal(owner.room.expiresAt,null)
    const loaded = await request(root, 'GET', undefined, owner.sessionId, 1)
    assert.deepEqual(loaded.body, owner.topology)
    assert.equal(loaded.headers.get('cache-control'), 'no-store')
    assert.equal((await request('/rooms', 'GET', undefined, owner.sessionId, 1)).body.rooms[0].id, owner.room.id)
    const resumed = await request('/session', 'GET', undefined, undefined, 1, { cookie: `netaxis-room=${owner.room.id}; netaxis-session=${owner.sessionId}` })
    assert.equal(resumed.body.participant.role, 'owner')
    assert.equal(resumed.body.room.id, owner.room.id)
    assert.equal((await request('/rooms')).status,401)
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
  assert.equal((await request(root + '/presence', 'GET', undefined, owner.sessionId)).body.participants.filter(m => m.connected).length, 1)
  await request('/session/leave', 'POST', { tabId: 'a' }, token, 0, { cookie: 'netaxis-room=' + owner.room.id })
  assert.equal((await request(root + '/presence', 'GET', undefined, owner.sessionId)).body.participants.filter(m => m.connected).length, 1)
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

test('browser Cisco config survives Cloud edits, workspace backup and remapped restore without another service', async () => {
  const {createCiscoLab}=await import('../src/client/lib/cisco-lab.js'),owner=await create('cisco-lan-demo')
  const topology=owner.topology,router=topology.nodes.find(n=>n.type==='router'),lab=createCiscoLab(topology)
  for(const input of ['enable','configure terminal','hostname Cloud-Router','end']) lab.run(router.id,input)
  const saved=lab.changes(router.id)
  const edit=await request('/rooms/'+owner.room.id+'/nodes/'+router.id,'PATCH',saved,owner.sessionId,1,{'x-topology-revision':String(owner.room.revision)})
  assert.equal(edit.status,200,JSON.stringify(edit.body)); assert.deepEqual(edit.body.node.data.cisco.commands,saved.data.cisco.commands)
  const archive=(await request('/rooms/'+owner.room.id+'/export','GET',undefined,owner.sessionId,0)).body
  const restored=await request('/rooms/restore','POST',{workspace:archive,displayName:'Restore CLI'},undefined,1)
  assert.equal(restored.status,201)
  const copy=restored.body.topology.nodes.find(n=>n.label==='Cloud-Router'); assert.notEqual(copy.id,router.id); assert.deepEqual(copy.data.cisco,saved.data.cisco)
  assert.match(createCiscoLab(restored.body.topology).run(copy.id,'show running-config').output,/Cloud-Router/)
})

test('hardware catalog is seeded once per model and available across cloud instances', async () => {
  const first = await request('/device-models'), second = await request('/device-models','GET',undefined,undefined,1)
  assert.equal(first.status,200); assert.deepEqual(second.body,first.body)
  assert.equal(first.body.models.find(m=>m.id==='fortigate-60f').physicalPortCount,10)
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM netaxis_device_models')).rows[0].count,first.body.models.length)
  const created=await create()
  const result=await request(`/rooms/${created.room.id}/nodes`,'POST',{type:'router',label:'MikroTik hEX S',position:{x:20,y:30},data:{model:'mikrotik-hex-s'}},created.sessionId,0,{'x-topology-revision':'0'})
  assert.equal(result.status,201,JSON.stringify(result.body))
  const saved=await request(`/rooms/${created.room.id}`,'GET',undefined,created.sessionId,1)
  assert.equal(saved.body.nodes[0].data.model,'mikrotik-hex-s')
})


test('real cloud email/password login keeps account rooms private and permanent across instances', async()=>{
 const password='Cloud-private-password-123!'
 const owner=await request('/auth/register','POST',{email:'cloud-owner@example.test',password},undefined,0,{},false)
 assert.equal(owner.status,201)
 const cookie=owner.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>c.startsWith('netaxis-account=')).join('; ')
 const created=await request('/rooms','POST',{name:'Private cloud lab',displayName:'Owner'},undefined,0,{cookie})
 assert.equal(created.status,201);assert.equal(created.body.room.expiresAt,null)
 assert.equal((await request('/auth/me','GET',undefined,undefined,1,{cookie})).body.user.id,owner.body.user.id)
 assert.equal((await request('/auth/logout','POST',{},undefined,1,{cookie})).status,204)
 assert.equal((await request('/rooms','GET',undefined,undefined,0,{cookie})).status,401)
 const login=await request('/auth/login','POST',{email:'cloud-owner@example.test',password},undefined,1,{},false)
 assert.equal(login.status,200)
 const fresh=login.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>c.startsWith('netaxis-account=')).join('; ')
 assert.equal((await request('/rooms','GET',undefined,undefined,0,{cookie:fresh})).body.rooms[0].id,created.body.room.id)
 const stranger=await cloudAccount()
 assert.equal((await request('/rooms/'+created.body.room.id,'GET',undefined,owner.body.user.id,1,{cookie:stranger.cookie})).status,401)
 for(let i=0;i<8;i++)assert.equal((await request('/auth/login','POST',{email:'cloud-owner@example.test',password:'Incorrect-password-123!'},undefined,i%2,{},false)).status,401)
 assert.equal((await request('/auth/login','POST',{email:'cloud-owner@example.test',password},undefined,0,{},false)).status,429)
 assert.equal((await request('/rooms/'+created.body.room.id,'DELETE',undefined,undefined,1,{cookie:fresh})).status,204)
})
