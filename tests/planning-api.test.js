import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { privateCidr } from '../src/server/lib/planning.js'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-planning-'))
process.env.DATA_DIR = directory; process.env.PORT = '0'; process.env.NODE_ENV = 'test'; process.env.PUBLIC_ORIGIN = ''
const { httpServer, closeServer } = await import('../src/server/index.js')
if (!httpServer.listening) await new Promise(resolve => httpServer.once('listening', resolve))
const base = `http://127.0.0.1:${httpServer.address().port}`
after(async () => { await closeServer(); fs.rmSync(directory, { recursive: true, force: true }) })
async function request(url, method = 'GET', body, headers = {}) {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, body: response.status === 204 ? null : await response.json() }
}
const input = { parent: '10.44.0.0/24', segments: [{ id: 'hq', name: 'HQ', site: 'HQ', department: 'IT', vlan: 10, hosts: 50, growth: 0, reservedCount: 2 }], assignments: [{ segmentId: 'hq', ip: '10.44.0.10', kind: 'server' }, { segmentId: 'hq', ip: '10.44.0.2', kind: 'reserved', mac: '11:22:33:44:55:66' }] }
test('persistent planning, role access and revision conflicts are enforced', async () => {
  const owner = (await request('/api/rooms', 'POST', { name: 'Planning permissions', displayName: 'Owner' })).body
  const root = `/api/rooms/${owner.room.id}/planning`, headers = { 'x-session-id': owner.sessionId }
  assert.equal((await request(root)).status, 401)
  const calculate = await request(root + '/calculate', 'POST', input, headers)
  assert.equal(calculate.status, 200); assert.deepEqual(calculate.body.design.issues, [])
  assert.equal((await request(root, 'PUT', { input, revision: 0 }, headers)).body.plan.revision, 1)
  assert.equal((await request(root, 'PUT', { input, revision: 0 }, headers)).status, 409)
  assert.equal((await request(root, 'GET', null, headers)).body.plan.input.parent, input.parent)
  const viewer = (await request('/api/rooms/join', 'POST', { joinCode: owner.room.joinCode, displayName: 'Viewer', role: 'viewer' })).body
  assert.equal((await request(root, 'GET', null, { 'x-session-id': viewer.sessionId })).status, 200)
  assert.equal((await request(root, 'PUT', { input, revision: 1 }, { 'x-session-id': viewer.sessionId })).status, 403)
  assert.equal((await request(root + '/probes', 'POST', { name: 'Unauthorized', segmentId: 'hq' }, { 'x-session-id': viewer.sessionId })).status, 403)
  assert.equal((await request(root + '/scale', 'POST', { input, changes: { hq: 150 } }, headers)).body.comparison[0].oldSubnetInsufficient, true)
})
test('probe enrollment, bounded jobs, scoped reports and live comparison work end-to-end', async () => {
  const owner = (await request('/api/rooms', 'POST', { name: 'Verify room', displayName: 'Owner' })).body
  const root = `/api/rooms/${owner.room.id}/planning`, headers = { 'x-session-id': owner.sessionId }
  await request(root, 'PUT', { input, revision: 0 }, headers)
  const probe = (await request(root + '/probes', 'POST', { name: 'HQ probe', segmentId: 'hq' }, headers)).body
  assert.ok(probe.token); assert.equal(probe.network, '10.44.0.0/26')
  const listed = (await request(root + '/probes', 'GET', null, headers)).body.probes[0]
  assert.equal(listed.token, undefined); assert.equal(listed.token_hash, undefined)
  const agentRoot = `/api/probes/${probe.id}/jobs`, auth = { Authorization: `Bearer ${probe.token}` }
  assert.equal((await request(agentRoot)).status, 401)
  assert.equal((await request(root + `/probes/${probe.id}/jobs`, 'POST', { kind: 'host', target: '8.8.8.8' }, headers)).status, 400)
  assert.equal((await request(root + `/probes/${probe.id}/jobs`, 'POST', { kind: 'scan', offset: 1000 }, headers)).status, 400)
  const queued = (await request(root + `/probes/${probe.id}/jobs`, 'POST', { kind: 'scan' }, headers)).body
  assert.equal(queued.coverage, 62)
  const job = (await request(agentRoot, 'GET', null, auth)).body.job
  assert.equal(job.id, queued.id); assert.ok(job.lease)
  assert.equal((await request(agentRoot, 'GET', null, auth)).body.job, null)
  const report = { lease: job.lease, observations: job.targets.map(ip => ({ ip, reachable: ['10.44.0.2', '10.44.0.20'].includes(ip), mac: ip === '10.44.0.2' ? 'aa:bb:cc:dd:ee:ff' : '' })) }
  assert.equal((await request(agentRoot + `/${job.id}/result`, 'POST', { ...report, observations: [{ ip: '8.8.8.8', reachable: true }] }, auth)).status, 400)
  assert.equal((await request(agentRoot + `/${job.id}/result`, 'POST', { ...report, lease: 'invalid-lease-value' }, auth)).status, 409)
  assert.equal((await request(agentRoot + `/${job.id}/result`, 'POST', report, auth)).status, 200)
  assert.equal((await request(agentRoot + `/${job.id}/result`, 'POST', report, auth)).status, 200)
  const verified = (await request(root + '/verification', 'GET', null, headers)).body
  for (const code of ['UNEXPECTED_DEVICE', 'MISSING_UNREACHABLE', 'RESERVED_CONFLICT', 'MAC_MISMATCH']) assert.ok(verified.comparison.findings.some(f => f.code === code), code)
  assert.equal(verified.observations.length, 62)
  assert.equal(verified.jobs[0].state, 'completed')
  assert.equal((await request(root + '/probes', 'GET', null, headers)).body.probes[0].online, true)
  await request(root, 'PUT', { input, revision: 1 }, headers)
  assert.equal((await request(root + '/verification', 'GET', null, headers)).body.observations.length, 0)
  await request(root + `/probes/${probe.id}`, 'DELETE', null, headers)
  assert.equal((await request(agentRoot, 'GET', null, auth)).status, 401)
})
test('public ranges cannot enroll probes and resized segments invalidate queued jobs', async () => {
  const owner = (await request('/api/rooms', 'POST', { name: 'Agent scope', displayName: 'Owner' })).body
  const root = `/api/rooms/${owner.room.id}/planning`, headers = { 'x-session-id': owner.sessionId }
  const publicPlan = { ...input, parent: '8.8.8.0/24', assignments: [] }
  await request(root, 'PUT', { input: publicPlan, revision: 0 }, headers)
  assert.equal((await request(root + '/probes', 'POST', { name: 'Public', segmentId: 'hq' }, headers)).status, 400)
  await request(root, 'PUT', { input, revision: 1 }, headers)
  const probe = (await request(root + '/probes', 'POST', { name: 'Private', segmentId: 'hq' }, headers)).body
  await request(root + `/probes/${probe.id}/jobs`, 'POST', { kind: 'host', target: '10.44.0.10' }, headers)
  const resized = { ...input, segments: [{ ...input.segments[0], hosts: 150 }] }
  await request(root, 'PUT', { input: resized, revision: 2 }, headers)
  assert.equal((await request(`/api/probes/${probe.id}/jobs`, 'GET', null, { Authorization: `Bearer ${probe.token}` })).body.job, null)
  assert.equal((await request(root + `/probes/${probe.id}/jobs`, 'POST', { kind: 'netstat' }, headers)).status, 409)
})

const localAddress = Object.values(os.networkInterfaces()).flat().find(n => n?.family === 'IPv4' && !n.internal && privateCidr(`${n.address}/24`))?.address
test('real agent executes local host, traceroute and netstat jobs and reports to the server', { timeout: 90_000, skip: !localAddress || process.platform !== 'win32' }, async () => {
  const owner = (await request('/api/rooms', 'POST', { name: 'Local agent smoke', displayName: 'Owner' })).body
  const root = `/api/rooms/${owner.room.id}/planning`, headers = { 'x-session-id': owner.sessionId }
  const localInput = { parent: `${localAddress}/24`, segments: [{ id: 'local', name: 'Local adapter', site: 'Test', vlan: 10, hosts: 1, growth: 0, reservedCount: 0, cidr: `${localAddress}/24` }], assignments: [] }
  await request(root, 'PUT', { input: localInput, revision: 0 }, headers)
  const probe = (await request(root + '/probes', 'POST', { name: 'Real local agent', segmentId: 'local' }, headers)).body
  for (const kind of ['host', 'traceroute', 'netstat', 'neighbor']) {
    const queued = await request(root + `/probes/${probe.id}/jobs`, 'POST', { kind, ...(['host', 'traceroute'].includes(kind) ? { target: localAddress } : {}) }, headers)
    assert.equal(queued.status, 201)
    const child = spawn(process.execPath, ['scripts/probe-agent.js', '--once'], { env: { ...process.env, NETAXIS_SERVER: base, NETAXIS_PROBE_ID: probe.id, NETAXIS_PROBE_TOKEN: probe.token, NETAXIS_PROBE_NETWORK: probe.network }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let output = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Agent smoke timed out')) }, 60_000)
      child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('exit', code => { clearTimeout(timer); resolve(code) })
    })
    assert.equal(code, 0, output)
    const verification = (await request(root + '/verification', 'GET', null, headers)).body
    const job = verification.jobs.find(j => j.id === queued.body.id)
    assert.equal(job.state, 'completed', job.result?.error || output)
    if (kind === 'host') assert.equal(job.result.observations[0].reachable, true)
    if (['traceroute', 'netstat'].includes(kind)) assert.ok(job.result.output.length > 0)
    if (kind === 'neighbor') assert.equal(job.result.observations.length, 254)
  }
})
