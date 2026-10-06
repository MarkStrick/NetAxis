import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

async function start(directory, extra = {}) {
  const child = spawn(process.execPath, ['src/server/index.js'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', NODE_ENV: 'test', PUBLIC_ORIGIN: '', DATA_DIR: directory, ...extra }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const base = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Startup timed out: ' + output)) }, 10_000)
    child.stdout.on('data', data => { output += data; const match = output.match(/listening on (http:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    child.stderr.on('data', data => { output += data })
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Startup failed (' + code + '): ' + output)) })
  })
  return { child, base }
}
async function stop(child) { if (child.exitCode !== null) return; const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done }
test('topology and owner access survive a complete server restart', { timeout: 20_000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-restart-'))
  let server
  try {
    server = await start(directory)
    const created = await (await fetch(server.base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Durable owner', displayName: 'Owner' }) })).json()
    const headers = { 'Content-Type': 'application/json', 'x-session-id': created.sessionId, 'x-topology-revision': '0' }
    assert.equal((await fetch(`${server.base}/api/rooms/${created.room.id}/nodes`, { method: 'POST', headers, body: JSON.stringify({ type: 'server', label: 'Persistent', position: { x: 1, y: 2 }, data: { ipv6: '2001:db8::10/64' } }) })).status, 201)
    const planInput = { parent: '10.40.0.0/16', segments: [{ id: 'hq', name: 'HQ', vlan: 10, hosts: 150, growth: 20 }], assignments: [] }
    assert.equal((await fetch(`${server.base}/api/rooms/${created.room.id}/planning`, { method: 'PUT', headers, body: JSON.stringify({ input: planInput, revision: 0 }) })).status, 200)
    const template = await (await fetch(server.base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Durable template', displayName: 'Owner', templateId: 'branch-hq' }) })).json()
    await stop(server.child)
    server = await start(directory)
    const loaded = await (await fetch(`${server.base}/api/rooms/${created.room.id}`, { headers })).json()
    assert.equal(loaded.nodes[0].label, 'Persistent'); assert.equal(loaded.room.revision, 1)
    assert.equal(loaded.room.expiresAt, created.room.expiresAt)
    const changed = await fetch(`${server.base}/api/rooms/${created.room.id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Owner still authorized' }) })
    assert.equal(changed.status, 200)
    const resumed = await (await fetch(server.base + '/api/session', { headers: { cookie: `netaxis-session=${created.sessionId}; netaxis-room=${created.room.id}` } })).json()
    assert.equal(resumed.participant.role, 'owner')
    const planning = await (await fetch(`${server.base}/api/rooms/${created.room.id}/planning`, { headers })).json()
    assert.equal(planning.plan.revision, 1)
    assert.equal(planning.plan.design.segments[0].cidr, '10.40.0.0/24')
    const templateHeaders = { 'x-session-id': template.sessionId }
    const restoredTemplate = await (await fetch(`${server.base}/api/rooms/${template.room.id}`, { headers: templateHeaders })).json()
    assert.deepEqual(restoredTemplate.template, template.topology.template)
    assert.equal(restoredTemplate.room.expiresAt, template.room.expiresAt)
    assert.deepEqual(restoredTemplate.nodes, template.topology.nodes)
    const templatePlan = await (await fetch(`${server.base}/api/rooms/${template.room.id}/planning`, { headers: templateHeaders })).json()
    assert.equal(templatePlan.plan.input.parent, '10.60.0.0/16')
  } finally { if (server) await stop(server.child); fs.rmSync(directory, { recursive: true, force: true }) }
})
test('production refuses insecure startup configuration', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-config-'))
  try { await assert.rejects(start(directory, { NODE_ENV: 'production' }), /Production requires PUBLIC_ORIGIN/) }
  finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('production serves the built app, persists room access and emits Secure cookies', { timeout: 20_000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-production-'))
  let server
  try {
    server = await start(directory, { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://netaxis.example.com' })
    const root = await fetch(server.base)
    assert.equal(root.status, 200)
    const html = await root.text()
    const asset = html.match(/src="([^"]+\.js)"/)[1]
    assert.equal((await fetch(server.base + asset)).status, 200)
    const created = await fetch(server.base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Production room', displayName: 'Owner' }) })
    assert.equal(created.status, 201)
    assert.match(created.headers.get('set-cookie'), /Secure/)
    const cookie = created.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    assert.equal((await fetch(server.base + '/api/rooms', { headers: { cookie } })).status, 200)
    await stop(server.child)
    server = await start(directory, { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://netaxis.example.com' })
    const resumed = await (await fetch(server.base + '/api/session', { headers: { cookie } })).json()
    assert.equal(resumed.participant.role, 'owner')
    assert.equal((await fetch(server.base + '/api/rooms', { headers: { cookie, origin: 'https://wrong.example.com' } })).status, 403)
  } finally { if (server) await stop(server.child); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('online SQLite backup produces a readable consistent snapshot', { timeout: 20_000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-backup-'))
  let server
  try {
    server = await start(directory)
    await fetch(server.base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Backup Room', displayName: 'Owner' }) })
    const backups = path.join(directory, 'backups')
    const job = spawn(process.execPath, ['scripts/backup.js'], { env: { ...process.env, DATA_DIR: directory, BACKUP_DIR: backups }, stdio: 'pipe', windowsHide: true })
    const code = await new Promise(resolve => job.once('exit', resolve))
    assert.equal(code, 0)
    const copy = new Database(path.join(backups, fs.readdirSync(backups)[0]), { readonly: true })
    try { assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok'); assert.equal(copy.prepare('SELECT name FROM rooms').get().name, 'Backup Room') }
    finally { copy.close() }
  } finally { if (server) await stop(server.child); fs.rmSync(directory, { recursive: true, force: true }) }
})
