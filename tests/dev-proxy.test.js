import { captchaFetch as fetch } from './helpers/captcha.js'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import { io } from 'socket.io-client'
import viteConfig from '../vite.config.js'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netaxis-proxy-'))
process.env.DATA_DIR = directory; process.env.PORT = '0'; process.env.NODE_ENV = 'test'; process.env.PUBLIC_ORIGIN = ''
const { httpServer, closeServer } = await import('../src/server/index.js')
if (!httpServer.listening) await new Promise(resolve => httpServer.once('listening', resolve))
const target = `http://127.0.0.1:${httpServer.address().port}`
const proxy = await createServer({ configFile: false, root: directory, cacheDir: path.join(directory, 'vite-cache'), optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 0, proxy: Object.fromEntries(Object.entries(viteConfig.server.proxy).map(([route, options]) => [route, { ...options, target }])) } })
await proxy.listen()
const base = `http://127.0.0.1:${proxy.httpServer.address().port}`
after(async () => { await proxy.close(); await closeServer(); fs.rmSync(directory, { recursive: true, force: true }) })
async function request(url, body, extraHeaders = {}) {
  const response = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...extraHeaders }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
test('browser-origin room creation and template import work through the real Vite proxy', async () => {
  const created = await request('/api/rooms', { name: 'Browser workspace', displayName: 'Owner' })
  assert.equal(created.status, 201)
  const owner = created.body
  const imported = await request(`/api/rooms/${owner.room.id}/topology/import`, {
    nodes: [{ id: 'template-pc', type: 'pc', label: 'Template PC', position: { x: 100, y: 100 }, data: { ipv4: '10.10.0.10', cidr: 24, status: 'online' } }, { id: 'template-router', type: 'router', label: 'Router', position: { x: 300, y: 100 }, data: { ipv4: '10.10.0.1', cidr: 24, status: 'online' } }],
    edges: [{ id: 'template-link', sourceNodeId: 'template-pc', targetNodeId: 'template-router', medium: 'ethernet', status: 'active' }],
  }, { 'x-session-id': owner.sessionId, 'x-topology-revision': '0' })
  assert.equal(imported.status, 200)
  assert.equal(imported.body.nodes.length, 2)
  assert.equal(imported.body.edges.length, 1)
  const socket = io(base, { auth: { roomId: owner.room.id, sessionId: owner.sessionId }, extraHeaders: { Origin: base }, transports: ['websocket'], reconnection: false })
  try {
    const sync = await new Promise((resolve, reject) => { socket.once('room:sync', resolve); socket.once('connect_error', reject); setTimeout(() => reject(new Error('Proxied socket timed out')), 3000).unref() })
    assert.equal(sync.nodes.length, 2)
  } finally { socket.disconnect() }
})
test('Vite proxy continues rejecting browser requests from another origin', async () => {
  const response = await request('/api/rooms', { name: 'Cross-site', displayName: 'Owner' }, { Origin: 'https://attacker.example' })
  assert.equal(response.status, 403)
  assert.equal(response.body.error, 'ORIGIN_DENIED')
})
