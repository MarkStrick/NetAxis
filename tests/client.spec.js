import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/client/App.vue'

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
beforeEach(() => {
  calls = []; sockets.length = 0; localStorage.clear()
  topology = { nodes: [node('a', 100), node('b', 500)], edges: [{ id: 'ab', sourceNodeId: 'a', targetNodeId: 'b', medium: 'ethernet', status: 'active' }] }
  vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
    calls.push({ url, ...options })
    if (url === '/api/session') return response({ room, sessionId: 'test-session', participant, topology: { room, ...topology } })
    if (url === '/api/rooms') return response({ rooms: [] })
    if (url === '/api/session/leave') return response(null, 204)
    if (url.endsWith('/nodes') && options.method === 'POST') {
      const created = { ...JSON.parse(options.body), id: 'added-' + topology.nodes.length }; topology.nodes.push(created); room.revision++
      return response({ room: { ...room }, node: created })
    }
    if (url.endsWith('/edges') && options.method === 'POST') {
      const created = { ...JSON.parse(options.body), id: 'added-edge' }; topology.edges.push(created); room.revision++
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
  participant.role = 'owner'
})
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.unstubAllGlobals() })
async function start() { wrapper = mount(App, { attachTo: document.body }); await flushPromises(); if (!wrapper.find('.device-list-row').exists()) throw new Error(wrapper.text()); await wrapper.find('.device-list-row').trigger('click'); await flushPromises() }
function configureSvg() {
  const svg = wrapper.find('.topology-svg').element
  svg.getScreenCTM = () => ({ inverse: () => ({ a: 2, d: 2, e: -20, f: -40 }) })
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform(matrix) { return { x: this.x * matrix.a + matrix.e, y: this.y * matrix.d + matrix.f } } })
  const camera = wrapper.find('.topology-svg > g').attributes('transform').match(/translate\(([-.\d]+) ([-.\d]+)\) scale\(([-.\d]+)\)/).slice(1).map(Number)
  return { zoom: camera[2], point: (x, y) => ({ clientX: (camera[0] + x * camera[2]) / 2 + 10, clientY: (camera[1] + y * camera[2]) / 2 + 20, pointerId: 1 }) }
}
describe('editor regression workflows', () => {
  async function freshLanding() {
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      calls.push({ url, ...options })
      if (url === '/api/session') return response({ error: 'SESSION_EXPIRED' }, 401)
      if (url === '/api/rooms' && options.method === 'POST') return response({ room, sessionId: 'test-session', participant, topology: { room, nodes: [], edges: [] } }, 201)
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
  it('uses a template by creating its room and importing devices and links', async () => {
    await freshLanding()
    await wrapper.find('.project-card .secondary-action').trigger('click'); await flushPromises()
    await wrapper.find('.preset-name-field input').setValue('Template owner')
    await wrapper.find('.project-hero-actions .primary-action').trigger('click'); await flushPromises()
    const imported = calls.find(call => call.url.endsWith('/topology/import'))
    expect(imported).toBeDefined()
    const payload = JSON.parse(imported.body)
    expect(payload.nodes.length).toBeGreaterThan(0)
    expect(payload.edges.length).toBeGreaterThan(0)
    expect(imported.headers['x-topology-revision']).toBe('0')
    expect(payload.edges.every(edge => payload.nodes.some(node => node.id === edge.sourceNodeId) && payload.nodes.some(node => node.id === edge.targetNodeId))).toBe(true)
    expect(wrapper.find('.workspace').exists()).toBe(true)
    expect(wrapper.find('.toast-error').exists()).toBe(false)
  })
  it('opens the landing page for a new visitor without a login request', async () => {
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      calls.push({ url, ...options })
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
    await start()
    const { point } = configureSvg()
    await wrapper.find('.node-port').trigger('pointerdown', point(100, 134))
    await wrapper.find('.canvas-stage').trigger('pointerup', point(500, 134)); await flushPromises()
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
    await start()
    const ports = wrapper.findAll('.node-port')
    await ports[0].trigger('keydown', { key: 'Enter' }); await ports[3].trigger('keydown', { key: 'Enter' }); await flushPromises()
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
