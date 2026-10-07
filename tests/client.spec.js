import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/client/App.vue'
import { presetProjects, instantiateTemplate } from '../src/shared/templates.js'
import { calculatePlan } from '../src/server/lib/planning.js'
import { DEFAULT_ROOM_NAME } from '../src/shared/room-defaults.js'

const sockets = vi.hoisted(() => [])
vi.mock('socket.io-client', () => ({ io: () => {
  const handlers = {}, socket = { on: (event, callback) => { handlers[event] = callback }, io: { on: () => {} }, removeAllListeners: () => {}, disconnect: () => {}, handlers }
  sockets.push(socket); return socket
} }))
let wrapper, calls, topology
const node = (id, x) => ({ id, type: 'pc', label: id, position: { x, y: 100 }, data: { status: 'online' } })
const room = { id: 'test-room', name: 'Test', joinCode: 'TEST123456', description: '', accessMode: 'editor', revision: 0 }
const participant = { id: 'owner', role: 'owner', displayName: 'Owner' }
function response(value, status = 200) { return Promise.resolve({ ok: status < 400, status, json: async () => value }) }
const captcha = { id: 'challenge-id', image: 'data:image/png;base64,', expiresAt: Date.now() + 300000 };
async function solveCaptcha() {
  expect(wrapper.find('[aria-labelledby="captcha-title"]').exists()).toBe(true);
  await wrapper.find('input[aria-label="รหัสจากภาพ"]').setValue('123456');
  await wrapper.find('.captcha-form').trigger('submit'); await flushPromises();
}
beforeEach(() => {
  window.history.replaceState({}, '', '/room/test-room')
  calls = []; sockets.length = 0; localStorage.clear()
  topology = { nodes: [node('a', 100), node('b', 500)], edges: [{ id: 'ab', sourceNodeId: 'a', targetNodeId: 'b', medium: 'ethernet', status: 'active' }] }
  vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
    calls.push({ url, ...options })
    if (url === '/api/visitor') return response({ verified: true })
    if (url === '/api/session') return response({ room, sessionId: 'test-session', participant, topology: { room, ...topology } })
    if (url === '/api/rooms') return response({ rooms: [] })
    if (url === '/api/session/leave') return response(null, 204)
    if (url.endsWith('/nodes') && options.method === 'POST') {
      const created = { ...JSON.parse(options.body), id: 'added-' + topology.nodes.length }; topology.nodes.push(created); room.revision++
      return response({ room: { ...room }, node: created })
    }
    if (url.endsWith('/edges') && options.method === 'POST') {
      const created = { ...JSON.parse(options.body), id: 'added-edge' }; topology.edges = [...topology.edges, created]; room.revision++
      return response({ room: { ...room }, edge: created })
    }
    if (url.endsWith('/topology/import')) {
      topology = JSON.parse(options.body); room.revision++
      return response({ room: { ...room }, ...topology })
    }
    if (url.includes('/nodes/') && options.method === 'PATCH') {
      const updated = JSON.parse(options.body); topology.nodes = topology.nodes.map(item => item.id === updated.id ? updated : item); room.revision++
      return response({ room: { ...room }, node: updated })
    }
    if (url.includes('/nodes/') && options.method === 'DELETE') {
      const id = url.split('/').at(-1); topology.nodes = topology.nodes.filter(item => item.id !== id); topology.edges = topology.edges.filter(edge => edge.sourceNodeId !== id && edge.targetNodeId !== id); room.revision++
      return response({ room: { ...room }, node: { id } })
    }
    return response({ message: 'Unexpected request ' + url }, 500)
  }))
  room.revision = 0
  delete room.expiresAt
  participant.role = 'owner'
})
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })
it('Vercel polls saved topology without opening a socket and stops polling on unmount', async () => {
  vi.stubEnv('VITE_DEPLOYMENT_MODE', 'vercel'); vi.useFakeTimers()
  let remoteRevision = 1
  const original = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn((url, options) => {
    if (url.endsWith('/sync')) return response({ room: { ...room, revision: remoteRevision }, participant, participants: [participant], topology: { room: { ...room, revision: remoteRevision }, nodes: [node('remote-device', 150)], edges: [] } })
    return original(url, options)
  }))
  await start()
  expect(sockets).toHaveLength(0)
  expect(wrapper.text()).toContain('remote-device')
  remoteRevision = 2
  await vi.advanceTimersByTimeAsync(2000); await flushPromises()
  const fetchMock = globalThis.fetch
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/sync'))).toHaveLength(2)
  wrapper.unmount(); wrapper = null
  await vi.advanceTimersByTimeAsync(10000)
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/sync'))).toHaveLength(2)
})
async function start() { wrapper = mount(App, { attachTo: document.body }); await flushPromises(); if (!wrapper.find('.device-list-row').exists()) throw new Error(wrapper.text()); await wrapper.find('.device-list-row').trigger('click'); await flushPromises() }
it('verifies only the first visit, then creates rooms without further captcha and remembers a return visit', async () => {
  window.history.replaceState({}, '', '/workspace')
  let verified = false, captchaRequests = 0
  vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
    calls.push({ url, ...options })
    if (url === '/api/visitor') return response({ verified })
    if (url === '/api/captcha') { captchaRequests++; return response({ ...captcha, expiresAt: Date.now() + 300000 }) }
    if (url === '/api/captcha/verify') { verified = true; return response({ verified }) }
    if (url === '/api/session') return response({}, 401)
    if (url === '/api/session/leave') return response(null, 204)
    if (url === '/api/rooms' && options.method === 'POST') return response({ room, sessionId: 'test-session', participant, topology: { room, nodes: [], edges: [] } }, 201)
    if (url === '/api/rooms') return response({ rooms: [] })
    return response({}, 500)
  }))
  wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  expect(wrapper.find('.visitor-gate').exists()).toBe(true); expect(wrapper.find('.room-landing').exists()).toBe(false)
  await solveCaptcha(); expect(wrapper.find('.room-landing').exists()).toBe(true)
  for (let i = 0; i < 2; i++) {
    await wrapper.find('input[placeholder="เช่น HQ Network 2026"]').setValue('Verified room')
    await wrapper.find('.create-room-panel input[placeholder="ชื่อของคุณ"]').setValue('Owner')
    await wrapper.find('.create-room-panel .primary-action').trigger('click'); await flushPromises()
    expect(wrapper.find('.workspace').exists()).toBe(true)
    expect(JSON.parse(calls.find(call => call.url === '/api/rooms' && call.method === 'POST').body).captcha).toBeUndefined()
    await wrapper.find('button[title="ออกจากห้อง"]').trigger('click'); await flushPromises()
  }
  wrapper.unmount(); wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  expect(wrapper.find('.room-landing').exists()).toBe(true); expect(wrapper.find('.captcha-form').exists()).toBe(false); expect(captchaRequests).toBe(1)
})
it('room chat escapes HTML, deduplicates deliveries and keeps an unsent draft when closed', async () => {
  await start(); sockets[0].handlers.connect()
  const message = { id: 1, text: '<img src=x onerror=alert(1)>', displayName: 'Guest', participantId: 'guest', role: 'viewer', createdAt: new Date().toISOString() }
  sockets[0].handlers['room:message']({ message }); await flushPromises()
  expect(wrapper.find('.unread-badge').text()).toBe('1')
  await wrapper.find('.community-toggle').trigger('click'); await flushPromises()
  expect(wrapper.find('.chat-message p').text()).toBe(message.text); expect(wrapper.find('.chat-message img').exists()).toBe(false)
  sockets[0].handlers['room:message']({ message }); await flushPromises()
  expect(wrapper.findAll('.chat-message')).toHaveLength(1)
  expect(wrapper.find('.unread-badge').exists()).toBe(false)
  await wrapper.find('#room-chat-message').setValue('draft'); await wrapper.find('.community-toggle').trigger('click')
  await wrapper.find('.community-toggle').trigger('click'); expect(wrapper.find('#room-chat-message').element.value).toBe('draft')
  const original = fetch.getMockImplementation()
  fetch.mockImplementation((url, options) => url.endsWith('/messages') ? response({ message: { ...message, ...JSON.parse(options.body), id: 2, participantId: participant.id, displayName: 'Owner' } }, 201) : original(url, options))
  await wrapper.find('.chat-composer').trigger('submit'); await flushPromises()
  expect(wrapper.findAll('.chat-message')).toHaveLength(2); expect(wrapper.find('#room-chat-message').element.value).toBe('')
})
it('member list distinguishes offline members, shows roles and allows a viewer to change their own status', async () => {
  participant.role = 'viewer'; await start(); sockets[0].handlers.connect()
  sockets[0].handlers['room:presence']({ participants: [{ ...participant, connected: true, status: 'online' }, { id: 'offline', displayName: 'Offline editor', role: 'editor', connected: false, status: 'offline' }] })
  await wrapper.find('.community-toggle').trigger('click'); await wrapper.findAll('.community-tabs button')[1].trigger('click')
  expect(wrapper.findAll('.member-list li')).toHaveLength(2); expect(wrapper.find('.member-list').text()).toContain('ดูอย่างเดียว'); expect(wrapper.find('.member-list').text()).toContain('ออฟไลน์')
  const original = fetch.getMockImplementation()
  fetch.mockImplementation((url, options) => url.endsWith('/member-status') ? response({ status: 'busy', participants: [{ ...participant, connected: true, status: 'busy' }] }) : original(url, options))
  await wrapper.find('select[aria-label="สถานะของคุณ"]').setValue('busy'); await flushPromises()
  expect(wrapper.find('.member-status').text()).toBe('ไม่ว่าง')
})
it('passes topology devices into Planning and guards both Topology and Leave navigation for unsaved IPAM', async () => {
  const input = { parent: '10.20.0.0/24', segments: [{ id: 'hq', name: 'HQ', vlan: 10, hosts: 50, growth: 0 }], assignments: [] }
  topology.nodes[0].data = { ipv4: '10.20.0.10', cidr: 24, status: 'online' }
  const original = fetch.getMockImplementation()
  fetch.mockImplementation((url, options = {}) => {
    if (!url.includes('/planning')) return original(url, options)
    if (url.endsWith('/probes')) return response({ probes: [] })
    if (url.endsWith('/verification')) return response({ observations: [], jobs: [], comparison: { findings: [], utilization: [], freshCount: 0, staleCount: 0 } })
    if (url.endsWith('/calculate')) return response({ design: calculatePlan(JSON.parse(options.body)) })
    return response({ plan: { revision: 1, input, design: calculatePlan(input) } })
  })
  await start()
  await wrapper.find('.planning-toggle').trigger('click'); await flushPromises()
  await wrapper.findAll('.planning-steps button')[3].trigger('click')
  await wrapper.findAll('.planning-surface button').find(b => b.text().includes('Topology')).trigger('click'); await flushPromises()
  expect(wrapper.find('input[aria-label="Planned IP"]').element.value).toBe('10.20.0.10')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })); await flushPromises()
  expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  await wrapper.find('.planning-toggle').trigger('click'); await flushPromises()
  expect(wrapper.find('.draft-keep').exists()).toBe(true)
  await wrapper.find('.draft-keep').trigger('click')
  await wrapper.find('button[title="ออกจากห้อง"]').trigger('click'); await flushPromises()
  expect(calls.some(c => c.url === '/api/session/leave')).toBe(false)
  await wrapper.find('.draft-discard').trigger('click'); await flushPromises()
  expect(wrapper.find('.room-landing').exists()).toBe(true)
  expect(calls.some(c => c.url === '/api/session/leave')).toBe(true)
})
it('Backup downloads the full server archive including saved IPAM and scenarios', async () => {
  const installed = instantiateTemplate(presetProjects[0], 'export-test')
  const archive = { format: 'netaxis-workspace', version: 1, room, nodes: installed.nodes, edges: installed.edges, plan: installed.plan, template: installed.info }
  const original = fetch.getMockImplementation(), blobs = []
  fetch.mockImplementation((url, options) => url.endsWith('/export') ? response(archive) : original(url, options))
  vi.stubGlobal('URL', { createObjectURL: vi.fn(blob => { blobs.push(blob); return 'blob:backup' }), revokeObjectURL: vi.fn() })
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await start()
  await wrapper.find('button[title="สำรอง Workspace JSON"]').trigger('click'); await flushPromises()
  const text = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blobs[0]) })
  expect(JSON.parse(text)).toEqual(archive)
  expect(clicked.mock.instances[0].download).toBe('netaxis-workspace.json')
})
it('restores a previewed workspace from the landing page and opens its scenarios', async () => {
  window.history.replaceState({}, '', '/workspace')
  const installed = instantiateTemplate(presetProjects[0], 'restore-test')
  const archive = { format: 'netaxis-workspace', version: 1, room, nodes: installed.nodes, edges: installed.edges, plan: installed.plan, template: installed.info }
  fetch.mockImplementation((url, options = {}) => {
    calls.push({ url, ...options })
    if (url === '/api/captcha') return response(captcha)
    if (url === '/api/visitor') return response({ verified: true })
    if (url === '/api/session') return response({}, 401)
    if (url === '/api/rooms') return response({ rooms: [] })
    if (url === '/api/rooms/restore') return response({ room, sessionId: 'restored', participant, topology: { room, nodes: installed.nodes, edges: installed.edges, template: installed.info } }, 201)
    return response({}, 500)
  })
  wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  const file = wrapper.find('input[aria-label="Restore workspace file"]')
  Object.defineProperty(file.element, 'files', { configurable: true, value: [{ size: 1000, text: async () => JSON.stringify(archive) }] })
  await file.trigger('change'); await flushPromises()
  expect(wrapper.find('.restore-preview').text()).toContain('devices')
  await wrapper.find('.restore-preview input').setValue('Restored owner')
  await wrapper.find('.restore-workspace-action').trigger('click'); await flushPromises()
  expect(JSON.parse(calls.find(c => c.url === '/api/rooms/restore').body)).toEqual({ displayName: 'Restored owner', workspace: archive })
  expect(wrapper.findAll('.node-group')).toHaveLength(installed.nodes.length)
  expect(wrapper.find('.sim-ready-scenarios').exists()).toBe(true)
})
function configureSvg() {
  const svg = wrapper.find('.topology-svg').element
  svg.getScreenCTM = () => ({ inverse: () => ({ a: 2, d: 2, e: -20, f: -40 }) })
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform(matrix) { return { x: this.x * matrix.a + matrix.e, y: this.y * matrix.d + matrix.f } } })
  const camera = wrapper.find('.topology-svg > g').attributes('transform').match(/translate\(([-.\d]+) ([-.\d]+)\) scale\(([-.\d]+)\)/).slice(1).map(Number)
  return { zoom: camera[2], point: (x, y) => ({ clientX: (camera[0] + x * camera[2]) / 2 + 10, clientY: (camera[1] + y * camera[2]) / 2 + 20, pointerId: 1 }) }
}
describe('editor regression workflows', () => {
  async function freshLanding() {
    window.history.replaceState({}, '', '/workspace')
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      calls.push({ url, ...options })
      if (url === '/api/captcha') return response(captcha)
      if (url === '/api/visitor') return response({ verified: true })
    if (url === '/api/session') return response({ error: 'SESSION_EXPIRED' }, 401)
      if (url === '/api/rooms' && options.method === 'POST') {
        const preset = presetProjects.find(p => p.id === JSON.parse(options.body).templateId)
        if (preset) {
          const installed = instantiateTemplate(preset, 'test-template')
          topology = { nodes: installed.nodes, edges: installed.edges, template: installed.info }
          return response({ room: { ...room, revision: 1 }, sessionId: 'test-session', participant, topology: { room: { ...room, revision: 1 }, ...topology } }, 201)
        }
        return response({ room, sessionId: 'test-session', participant, topology: { room, nodes: [], edges: [] } }, 201)
      }
      if (url === '/api/rooms') return response({ rooms: [] })
      if (url.endsWith('/topology/import')) { topology = JSON.parse(options.body); return response({ room: { ...room, revision: 1 }, ...topology }) }
      return response({ message: 'Unexpected request ' + url }, 500)
    }))
    wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  }
  it('creates a room from the landing form and opens the editor', async () => {
    await freshLanding()
    await wrapper.find('input[placeholder="เช่น HQ Network 2026"]').setValue('New workspace')
    await wrapper.find('.form-panel:not(.join-panel) input[placeholder="ชื่อของคุณ"]').setValue('Owner')
    await wrapper.find('.form-panel:not(.join-panel) .primary-action').trigger('click'); await flushPromises()
    expect(wrapper.find('.workspace').exists()).toBe(true)
    expect(wrapper.find('.toast-error').exists()).toBe(false)
    const created = calls.find(call => call.url === '/api/rooms' && call.method === 'POST')
    expect(JSON.parse(created.body)).toMatchObject({ name: 'New workspace', displayName: 'Owner' })
  })
  it.each(['default', 'cleared'])('creates a room with the default name when the name is %s', async (mode) => {
    await freshLanding()
    const name = wrapper.find('.create-room-panel input[placeholder="เช่น HQ Network 2026"]')
    expect(name.element.value).toBe(DEFAULT_ROOM_NAME)
    if (mode === 'cleared') await name.setValue('   ')
    await wrapper.find('.create-room-panel input[placeholder="ชื่อของคุณ"]').setValue('Owner')
    await wrapper.find('.create-room-panel').trigger('submit'); await flushPromises()
    expect(wrapper.find('.workspace').exists()).toBe(true)
    expect(window.location.pathname).toBe('/room/test-room')
    expect(JSON.parse(calls.find(c => c.url === '/api/rooms' && c.method === 'POST').body).name).toBe(DEFAULT_ROOM_NAME)
  })
  it('separates the landing page from room forms and handles back navigation and room reloads', async () => {
    await freshLanding()
    await wrapper.find('.brand-lockup').trigger('click'); await flushPromises()
    expect(window.location.pathname).toBe('/')
    expect(wrapper.find('.landing-hero').exists()).toBe(true)
    expect(wrapper.find('.create-room-panel').exists()).toBe(false)
    await wrapper.find('.hero-actions .primary-action').trigger('click'); await flushPromises()
    expect(window.location.pathname).toBe('/workspace')
    expect(wrapper.find('.landing-hero').exists()).toBe(false)
    expect(wrapper.find('.create-room-panel').exists()).toBe(true)
    window.history.replaceState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate')); await flushPromises()
    expect(wrapper.find('.landing-hero').exists()).toBe(true)
    wrapper.unmount(); wrapper = null
    window.history.replaceState({}, '', '/room/test-room')
    const original = fetch.getMockImplementation()
    fetch.mockImplementation((url, options) => url === '/api/session' ? response({ room, sessionId: 'test-session', participant, topology: { room, ...topology } }) : original(url, options))
    await start()
    expect(window.location.pathname).toBe('/room/test-room')
  })
  it('shows creation failures next to the form and preserves entered values for retry', async () => {
    await freshLanding()
    const original = fetch.getMockImplementation()
    fetch.mockImplementation((url, options) => url === '/api/rooms' && options?.method === 'POST' ? response({ message: 'ลองใหม่อีกครั้ง' }, 503) : original(url, options))
    await wrapper.find('.create-room-panel input[placeholder="ชื่อของคุณ"]').setValue('Owner')
    await wrapper.find('.create-room-panel').trigger('submit'); await flushPromises()
    expect(wrapper.find('.create-room-panel .form-error').text()).toBe('ลองใหม่อีกครั้ง')
    expect(wrapper.find('.create-room-panel input[placeholder="ชื่อของคุณ"]').element.value).toBe('Owner')
    expect(wrapper.find('.create-room-panel button[type="submit"]').attributes('disabled')).toBeUndefined()
  })
  it('Tutorial teaches directly in the creation form and creates the room with the values the user entered', async () => {
    await freshLanding(); await wrapper.find('.tutorial-welcome button').trigger('click'); await flushPromises()
    expect(wrapper.find('[aria-label="Tutorial สร้างห้อง"]').exists()).toBe(true)
    expect(wrapper.find('.friendly-dialog').exists()).toBe(false)
    expect(wrapper.find('[data-tutorial-step="0"]').classes()).toContain('tutorial-target')
    expect(wrapper.find('[data-tutorial-step="0"] input').element.value).toBe(DEFAULT_ROOM_NAME)
    expect(wrapper.find('.creation-coach-actions button').attributes('disabled')).toBeUndefined()
    await wrapper.find('[data-tutorial-step="0"] input').setValue('Guided room'); await wrapper.find('.creation-coach-actions .secondary-action').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-tutorial-step="1"]').classes()).toContain('tutorial-target')
    await wrapper.find('[data-tutorial-step="1"] input').setValue('Guide owner'); await wrapper.find('.creation-coach-actions .secondary-action').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-tutorial-step="2"]').classes()).toContain('tutorial-target')
    await wrapper.find('[data-tutorial-step="2"] select').setValue('viewer'); await wrapper.find('.creation-coach-actions .secondary-action').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-tutorial-step="3"]').classes()).toContain('tutorial-target')
    await wrapper.find('[data-tutorial-step="3"]').trigger('click'); await flushPromises()
    expect(wrapper.find('.workspace').exists()).toBe(true)
    const created = calls.find(call => call.url === '/api/rooms' && call.method === 'POST')
    expect(JSON.parse(created.body)).toMatchObject({ name: 'Guided room', displayName: 'Guide owner', accessMode: 'viewer' }); expect(JSON.parse(created.body).captcha).toBeUndefined()
    expect(wrapper.find('.creation-coach').exists()).toBe(false)
  })
  it('opens an atomically created template with Realtime and ready scenarios', async () => {
    await freshLanding()
    await wrapper.find('.project-card .secondary-action').trigger('click'); await flushPromises()
    await wrapper.find('.preset-name-field input').setValue('Template owner')
    await wrapper.find('.project-hero-actions .primary-action').trigger('click'); await flushPromises()
    const created = calls.find(call => call.url === '/api/rooms' && call.method === 'POST')
    expect(JSON.parse(created.body)).toMatchObject({ templateId: 'office-lan', displayName: 'Template owner' })
    expect(calls.some(call => call.url.endsWith('/topology/import'))).toBe(false)
    expect(wrapper.findAll('.node-group')).toHaveLength(presetProjects[0].nodes.length)
    expect(wrapper.find('.sim-ready-scenarios').exists()).toBe(true)
    expect(wrapper.find('.sim-mode-tabs button').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('select[aria-label="Ready scenario"] option')).toHaveLength(4)
    expect(wrapper.find('.workspace').exists()).toBe(true)
    expect(wrapper.find('.toast-error').exists()).toBe(false)
  })
  it('picks Simple PDU endpoints on the canvas without dragging or mutating devices', async () => {
    topology.nodes.forEach((n, i) => { n.data.ipv4 = `10.0.0.${10 + i}`; n.data.cidr = 24 })
    await start()
    await wrapper.find('button[title="เปิด Network Simulation"]').trigger('click'); await flushPromises()
    expect(wrapper.find('.workspace').classes()).toContain('simulation-layout')
    await wrapper.find('.sim-simple-pdu').trigger('click')
    expect(wrapper.findAll('.node-port')).toHaveLength(0)
    const source = wrapper.find('.node-group[data-node-id="a"]')
    await source.trigger('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    await source.trigger('click')
    expect(source.classes()).toContain('pdu-source')
    await wrapper.find('.node-group[data-node-id="b"]').trigger('click'); await flushPromises()
    expect(wrapper.find('.sim-pdu-list').text()).toContain('Pending')
    expect(calls.some(call => ['POST', 'PATCH', 'DELETE'].includes(call.method))).toBe(false)
    for (let i = 0; i < 12 && wrapper.find('.sim-forward').attributes('disabled') === undefined; i++) { await wrapper.find('.sim-forward').trigger('click'); await flushPromises() }
    expect(wrapper.find('.sim-pdu-list').text()).toContain('Successful')
    expect(wrapper.find('.simulation-packet').exists()).toBe(true)
    await wrapper.find('.simulation-packet').trigger('click')
    expect(wrapper.find('.sim-inspector').text()).toContain('PDU Information')
    await wrapper.find('.packet-tracer-panel .panel-close').trigger('click'); await flushPromises()
    expect(wrapper.find('.simulation-packet').exists()).toBe(false)
    expect(wrapper.find('.toast-error').exists()).toBe(false)
  })
  it('opens the landing page for a new visitor without a login request', async () => {
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      calls.push({ url, ...options })
      if (url === '/api/visitor') return response({ verified: true })
    if (url === '/api/session') return response({ error: 'SESSION_EXPIRED' }, 401)
      if (url === '/api/rooms') return response({ rooms: [] })
      return response({ message: 'Unexpected request ' + url }, 500)
    }))
    wrapper = mount(App, { attachTo: document.body }); await flushPromises()
    expect(wrapper.find('.room-landing').exists()).toBe(true)
    expect(wrapper.text()).toContain('สร้างห้อง')
    expect(wrapper.find('input[autocomplete="current-password"]').exists()).toBe(false)
    expect(calls.some(call => call.url.startsWith('/api/access'))).toBe(false)
  })
  it('closing and reopening a running Simulator preserves the canvas, devices, links and camera without API mutations', async () => {
    let now = 0, sequence = 0
    const frames = new Map()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', callback => { const id = ++sequence; frames.set(id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
    topology.nodes.forEach((n, i) => { n.data.ipv4 = `10.0.0.${10 + i}`; n.data.cidr = 24 })
    await start()
    const original = JSON.stringify(topology), svg = wrapper.find('.topology-svg').element
    const cameraTransform = wrapper.find('.topology-svg > g').attributes('transform')
    for (let cycle = 0; cycle < 3; cycle++) {
      await wrapper.find('button[title="เปิด Network Simulation"]').trigger('click')
      await wrapper.find('select[aria-label="PDU destination"]').setValue('b')
      await wrapper.find('.sim-mode-tabs button').trigger('click')
      await wrapper.find('.sim-add-pdu').trigger('click')
      for (let i = 0; i < 10 && frames.size; i++) { const [id, callback] = frames.entries().next().value; frames.delete(id); now += 100; callback(now); await flushPromises() }
      expect(wrapper.find('.simulation-packet').exists()).toBe(true)
      const deviceElements = wrapper.findAll('.node-group').map(n => n.element)
      const link = wrapper.find('.edge-group').element
      await wrapper.find('button[aria-label="Close Simulator"]').trigger('click'); await flushPromises()
      expect(frames.size).toBe(0)
      expect(wrapper.find('.packet-tracer-panel').exists()).toBe(false)
      expect(wrapper.find('.workspace').classes()).not.toContain('simulation-layout')
      expect(wrapper.find('.simulation-packet').exists()).toBe(false)
      expect(wrapper.find('.topology-viewport > .topology-svg').element).toBe(svg)
      expect(wrapper.findAll('.node-group').map(n => n.element)).toEqual(deviceElements)
      expect(wrapper.find('.edge-group').element).toBe(link)
      expect(wrapper.findAll('.device-list-row')).toHaveLength(2)
      expect(wrapper.find('.topology-svg > g').attributes('transform')).toBe(cameraTransform)
      expect(JSON.stringify(topology)).toBe(original)
      expect(wrapper.find('.toast-error').exists()).toBe(false)
    }
    expect(calls.some(call => ['POST', 'PATCH', 'DELETE'].includes(call.method))).toBe(false)
  })
  it('counts down the room lifetime and closes the editor and running Simulator at expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'))
    room.expiresAt = new Date(Date.now() + 65_000).toISOString()
    topology.nodes.forEach((n, i) => { n.data.ipv4 = `10.0.0.${10 + i}`; n.data.cidr = 24 })
    vi.stubGlobal('requestAnimationFrame', () => 123)
    const cancelFrame = vi.fn(); vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    await start()
    expect(wrapper.find('.topbar-actions .room-lifetime').text()).toContain('เหลือ 0 ชม. 2 นาที')
    await wrapper.find('button[title="เปิด Network Simulation"]').trigger('click')
    await wrapper.find('select[aria-label="PDU destination"]').setValue('b')
    await wrapper.find('.sim-mode-tabs button').trigger('click')
    await wrapper.find('.sim-add-pdu').trigger('click')
    await vi.advanceTimersByTimeAsync(5000); await flushPromises()
    expect(wrapper.find('.topbar-actions .room-lifetime').text()).toContain('เหลือ 0 ชม. 1 นาที')
    await vi.advanceTimersByTimeAsync(60_000); await flushPromises()
    expect(wrapper.find('.workspace').exists()).toBe(false)
    expect(wrapper.find('.packet-tracer-panel').exists()).toBe(false)
    expect(wrapper.find('.room-landing').exists()).toBe(true)
    expect(wrapper.find('.toast-notice').text()).toContain('ห้องหมดอายุแล้ว')
    expect(cancelFrame).toHaveBeenCalledWith(123)
    expect(calls.some(call => ['POST', 'PATCH', 'DELETE'].includes(call.method))).toBe(false)
  })
  it('returns to the room list when the server expires the room', async () => {
    await start()
    sockets[0].handlers['room:expired'](); await flushPromises()
    expect(wrapper.find('.workspace').exists()).toBe(false)
    expect(wrapper.find('.room-landing').exists()).toBe(true)
    expect(wrapper.find('.toast-notice').text()).toContain('24 ชั่วโมง')
  })
  it('hides expired rooms even when an old room-list response is still displayed', async () => {
    const expired = { ...room, id: 'expired', name: 'Expired work', expiresAt: new Date(Date.now() - 1).toISOString() }
    const active = { ...room, id: 'active', name: 'Active work', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
    vi.stubGlobal('fetch', vi.fn(url => url === '/api/visitor' ? response({ verified: true }) : url === '/api/session' ? response({}, 401) : response({ rooms: [expired, active] })))
    wrapper = mount(App, { attachTo: document.body }); await flushPromises()
    expect(wrapper.findAll('.room-row')).toHaveLength(1)
    expect(wrapper.find('.room-row').text()).toContain('Active work')
    expect(wrapper.find('.room-row .room-lifetime').text()).toContain('เหลือ')
  })
  it('edits a Vue reactive node and sets a default CIDR with IPv4', async () => {
    await start()
    const input = wrapper.find('input[placeholder="192.168.1.10"]')
    await input.setValue('10.0.0.5'); await input.trigger('change'); await flushPromises()
    const patch = calls.find(call => call.method === 'PATCH')
    expect(JSON.parse(patch.body).data).toMatchObject({ ipv4: '10.0.0.5', cidr: 24 })
    expect(wrapper.find('.toast-error').exists()).toBe(false)
  })
  it('undoes and redoes a deletion with its connected links', async () => {
    await start()
    await wrapper.find('.delete-button').trigger('click')
    await wrapper.find('.delete-confirm-action').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.device-list-row')).toHaveLength(1)
    await wrapper.find('button[title="Undo"]').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.device-list-row')).toHaveLength(2)
    expect(topology.edges).toHaveLength(1)
    expect(wrapper.find('button[title="Redo"]').attributes('disabled')).toBeUndefined()
    await wrapper.find('button[title="Redo"]').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.device-list-row')).toHaveLength(1)
    expect(topology.edges).toHaveLength(0)
  })
  it('does not intercept Delete or Undo while typing in a field', async () => {
    await start()
    const input = wrapper.find('.properties-panel input')
    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }); input.element.dispatchEvent(event); await flushPromises()
    expect(wrapper.find('.delete-confirm-modal').exists()).toBe(false)
  })
  it('clears editor state on leave and stays on the landing page', async () => {
    await start()
    await wrapper.find('button[title="ออกจากห้อง"]').trigger('click'); await flushPromises()
    expect(wrapper.find('.workspace').exists()).toBe(false)
    expect(wrapper.find('.room-landing').exists()).toBe(true)
    expect(calls.some(call => call.url === '/api/session/leave')).toBe(true)
  })
  it('invalidates local Undo when another participant updates topology', async () => {
    await start()
    const input = wrapper.find('.properties-panel input')
    await input.setValue('Changed'); await input.trigger('change'); await flushPromises()
    expect(wrapper.find('button[title="Undo"]').attributes('disabled')).toBeUndefined()
    sockets[0].handlers['node:update']({ room: { ...room, revision: room.revision + 1 }, node: node('a', 150), actorId: 'other' }); await flushPromises()
    expect(wrapper.find('button[title="Undo"]').attributes('disabled')).toBeDefined()
  })
  it('drags using SVG coordinates on a scaled display and records an undoable move', async () => {
    await start()
    const { point } = configureSvg(), element = wrapper.find('.node-group')
    await element.trigger('pointerdown', point(120, 120))
    await element.trigger('pointermove', point(200, 170))
    await element.trigger('pointerup', point(200, 170)); await flushPromises()
    const patch = calls.find(call => call.method === 'PATCH')
    expect(JSON.parse(patch.body).position).toEqual({ x: 180, y: 150 })
    await wrapper.find('button[title="Undo"]').trigger('click'); await flushPromises()
    expect(topology.nodes[0].position).toEqual({ x: 100, y: 100 })
  })
  it('connects chosen ports using captured pointer coordinates', async () => {
    topology.edges = [];
    await start()
    const { point } = configureSvg()
    await wrapper.find('.node-port').trigger('pointerdown', point(100, 134))
    await wrapper.find('.canvas-stage').trigger('pointerup', point(500, 134)); await flushPromises()
    expect(wrapper.find('select[aria-label="Source connection port"]').exists()).toBe(true)
    await wrapper.find('.friendly-dialog .primary-action').trigger('click'); await flushPromises()
    const created = calls.find(call => call.url.endsWith('/edges') && call.method === 'POST')
    expect(JSON.parse(created.body)).toMatchObject({ sourceNodeId: 'a', targetNodeId: 'b', sourceSide: 'left', targetSide: 'left' })
  })
  it('cancels a pointer gesture without committing a partial move', async () => {
    await start(); const { point } = configureSvg(), element = wrapper.find('.node-group')
    await element.trigger('pointerdown', point(120, 120)); await element.trigger('pointermove', point(200, 170)); await element.trigger('pointercancel', point(200, 170)); await flushPromises()
    expect(calls.some(call => call.method === 'PATCH')).toBe(false)
    expect(wrapper.find('.node-group').attributes('transform')).toBe('translate(100 100)')
  })
  it('supports keyboard port connections and selecting links', async () => {
    topology.edges = [];
    await start()
    const ports = wrapper.findAll('.node-port')
    await ports[0].trigger('keydown', { key: 'Enter' }); await ports[3].trigger('keydown', { key: 'Enter' }); await flushPromises()
    await wrapper.find('.friendly-dialog .primary-action').trigger('click'); await flushPromises()
    const created = calls.find(call => call.url.endsWith('/edges') && call.method === 'POST')
    expect(JSON.parse(created.body)).toMatchObject({ sourceSide: 'left', targetSide: 'right' })
    await wrapper.find('.edge-group').trigger('keydown', { key: 'Enter' }); await flushPromises()
    expect(wrapper.find('.properties-panel').text()).toContain('LINK PROPERTIES')
  })
  it('viewers can select nodes but cannot edit or import', async () => {
    participant.role = 'viewer'; await start()
    expect(wrapper.find('.properties-panel').exists()).toBe(true)
    expect(wrapper.find('.properties-panel input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('button[title="นำเข้า topology JSON"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.node-port').exists()).toBe(false)
  })
  it('filters out links to hidden nodes', async () => {
    await start(); await wrapper.find('input[placeholder="ค้นหาอุปกรณ์"]').setValue('a'); await flushPromises()
    expect(wrapper.findAll('.node-group')).toHaveLength(1)
    expect(wrapper.findAll('.edge-group')).toHaveLength(0)
  })
  it('keeps newer remote edits when an earlier REST acknowledgement arrives late', async () => {
    await start()
    let resolveEdit
    vi.stubGlobal('fetch', vi.fn((_url, options) => options.method === 'PATCH' ? new Promise(resolve => { resolveEdit = resolve }) : response({})))
    await wrapper.find('.properties-panel input').setValue('Local'); await wrapper.find('.properties-panel input').trigger('change')
    sockets[0].handlers['node:update']({ room: { ...room, revision: 2 }, node: { ...node('a', 100), label: 'Newer remote' }, actorId: 'other' })
    resolveEdit({ ok: true, status: 200, json: async () => ({ room: { ...room, revision: 1 }, node: { ...node('a', 100), label: 'Local' } }) }); await flushPromises()
    expect(wrapper.find('.properties-panel input').element.value).toBe('Newer remote')
    expect(wrapper.find('button[title="Undo"]').attributes('disabled')).toBeDefined()
  })
  it('exports PNG with computed SVG styles and local references', async () => {
    await start()
    const style = document.createElement('style'); style.textContent = '.node-shape { fill: rgb(10, 20, 30); }'; document.head.append(style)
    const blobs = []
    vi.stubGlobal('Image', class { set src(_value) { queueMicrotask(() => this.onload()) } })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(blob => { blobs.push(blob); return 'blob:test' }), revokeObjectURL: vi.fn() })
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const button = wrapper.findAll('.utility-action').find(item => item.text().includes('Canvas PNG'))
    await button.trigger('click'); await flushPromises()
    const text = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blobs[0]) })
    expect(text).toContain('fill:rgb(10, 20, 30)')
    expect(text).not.toContain('class="node-port"')
    expect(blobs).toHaveLength(2)
    expect(wrapper.find('.toast-error').exists()).toBe(false)
    style.remove()
  })
})


it('room broadcast opens shared Simulator, closing keeps the run and reopening resumes its position', async () => {
  topology.nodes.forEach((n, i) => { n.data.ipv4 = `10.0.0.${10 + i}`; n.data.cidr = 24 })
  await start()
  const simulation = { revision: 1, topologyRevision: room.revision, runId: 'broadcast-run', controller: { id: 'another', displayName: 'Runner' }, request: { source: 'a', target: 'b', protocol: 'ICMP', ttl: 64, destinationPort: 80, payloadBytes: 32 }, position: 1, eventCount: 3, status: 'paused', speed: 1, anchor: 1000, serverTime: 1000 }
  sockets[0].handlers['room:simulation']({ simulation }); await flushPromises()
  expect(wrapper.find('.sim-audience-tabs').text()).toContain('ร่วมกันในห้อง')
  expect(wrapper.find('.sim-event-heading').text()).toContain('Captured 1 /')
  await wrapper.find('.simulation-panel .panel-close').trigger('click'); await flushPromises()
  sockets[0].handlers['room:simulation']({ simulation: { ...simulation, position: 2, revision: 2 } }); await flushPromises()
  expect(wrapper.find('.simulation-panel').exists()).toBe(false)
  await wrapper.find('button[title="เปิด Network Simulation"]').trigger('click'); await flushPromises()
  expect(wrapper.find('.sim-event-heading').text()).toContain('Captured 2 /')
  expect(calls.some(c => c.url.endsWith('/simulation'))).toBe(false)
})
