import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import SimulatorPanel from '../src/client/SimulatorPanel.vue'
import { presetProjects, instantiateTemplate } from '../src/shared/templates.js'
let wrapper
const topology = () => ({ nodes: [{ id: 'a', label: 'PC', type: 'pc', data: { ipv4: '10.0.0.10', cidr: 24, status: 'online' } }, { id: 's', label: 'Switch', type: 'switch', data: { ipv4: '10.0.0.1', cidr: 24, status: 'online' } }, { id: 'b', label: 'Server', type: 'server', data: { ipv4: '10.0.0.20', cidr: 24, status: 'online' } }], edges: [{ id: 'as', sourceNodeId: 'a', targetNodeId: 's', status: 'active' }, { id: 'sb', sourceNodeId: 's', targetNodeId: 'b', status: 'active' }] })
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })
async function start() { wrapper = mount(SimulatorPanel, { props: { topology: topology(), resetKey: 0 } }); await wrapper.find('select[aria-label="PDU destination"]').setValue('b') }
async function queue() { await wrapper.find('.sim-add-pdu').trigger('click'); await flushPromises() }
async function forward() { await wrapper.find('.sim-forward').trigger('click'); await flushPromises() }
async function finish() { for (let i = 0; i < 80 && wrapper.find('.sim-forward').attributes('disabled') === undefined; i++) await forward() }
function playbackClock() {
  let now = 0, sequence = 0
  const callbacks = new Map()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++sequence; callbacks.set(id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', id => callbacks.delete(id))
  return { callbacks, async frames(count) {
    for (let i = 0; i < count && callbacks.size; i++) {
      const [id, callback] = callbacks.entries().next().value; callbacks.delete(id)
      now += 100; callback(now); await flushPromises()
    }
  } }
}
it('captures one event at a time and completes ICMP only after the reply returns', async () => {
  await start(); await queue()
  expect(wrapper.find('.sim-pdu-list').text()).toContain('Pending')
  expect(wrapper.findAll('.sim-event-info')).toHaveLength(0)
  await forward()
  expect(wrapper.findAll('.sim-event-info')).toHaveLength(1)
  expect(wrapper.find('.sim-pdu-list').text()).toContain('In progress')
  expect(wrapper.findAll('.sim-osi-layers li')).toHaveLength(7)
  await finish()
  expect(wrapper.find('.sim-pdu-list').text()).toContain('Successful')
  expect(wrapper.find('.sim-arp-table').text()).toContain('2 entries')
  const last = wrapper.emitted('packets').at(-1)[0][0]
  expect(last.route.nodeIds.at(-1)).toBe('a')
})
it('protocol filters change visibility while all events continue to be captured', async () => {
  await start(); await queue()
  await wrapper.find('input[aria-label="ARP event filter"]').setValue(false)
  await finish()
  expect(wrapper.find('.sim-pdu-list').text()).toContain('Successful')
  expect(wrapper.findAll('.sim-event-info').every(e => e.attributes('data-protocol') === 'ICMP')).toBe(true)
  await wrapper.find('input[aria-label="ARP event filter"]').setValue(true)
  expect(wrapper.findAll('.sim-event-info').some(e => e.attributes('data-protocol') === 'ARP')).toBe(true)
})
it('PDU Information exposes OSI and Ethernet/IPv4 header details for selected events', async () => {
  await start(); await queue(); await forward(); await forward()
  const button = wrapper.findAll('.sim-detail-tabs button').find(b => b.text() === 'Inbound PDU Details')
  await button.trigger('click')
  expect(wrapper.find('.sim-header-fields').text()).toContain('ff:ff:ff:ff:ff:ff')
  expect(wrapper.find('.sim-header-fields').text()).toContain('ARP')
  await wrapper.findAll('.sim-event-info')[0].trigger('click')
  expect(wrapper.find('.sim-header-fields').text()).toBe('')
})
it('Simple PDU takes two canvas selections and queues ICMP', async () => {
  await start(); await wrapper.find('.sim-simple-pdu').trigger('click')
  expect(wrapper.emitted('picking').at(-1)[0].phase).toBe('source')
  wrapper.vm.pickNode('a'); await flushPromises()
  expect(wrapper.emitted('picking').at(-1)[0]).toMatchObject({ phase: 'target', source: 'a' })
  wrapper.vm.pickNode('b'); await flushPromises()
  expect(wrapper.find('.sim-pdu-list').text()).toContain('ICMP')
  expect(wrapper.emitted('picking').at(-1)[0].phase).toBe('')
})
it('Back, Replay and Reset restore status and clear emitted canvas markers', async () => {
  await start(); await queue(); await finish()
  await wrapper.findAll('.sim-play-controls button')[0].trigger('click')
  expect(wrapper.find('.sim-pdu-list').text()).toContain('In progress')
  await wrapper.find('.sim-replay').trigger('click')
  expect(wrapper.find('.sim-pdu-list').text()).toContain('Pending')
  expect(wrapper.findAll('.sim-event-info')).toHaveLength(0)
  await wrapper.find('.sim-reset').trigger('click')
  expect(wrapper.find('.sim-pdu-list tbody').text()).toBe('')
  expect(wrapper.emitted('packets').at(-1)[0]).toEqual([])
})
it('auto playback animates, pauses and realtime completes the queued PDU', async () => {
  let nextFrame = null, now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', callback => { nextFrame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => { nextFrame = null })
  async function frames(count) { for (let i = 0; i < count && nextFrame; i++) { const callback = nextFrame; nextFrame = null; now += 100; callback(now); await flushPromises() } }
  await start(); await queue(); await wrapper.find('.sim-auto-play').trigger('click')
  await frames(12)
  expect(wrapper.findAll('.sim-event-info').length).toBeGreaterThan(0)
  expect(wrapper.find('.sim-auto-play').text()).toContain('Pause')
  await wrapper.find('.sim-auto-play').trigger('click')
  expect(nextFrame).toBe(null)
  await wrapper.findAll('.sim-mode-tabs button')[0].trigger('click')
  await frames(150)
  expect(wrapper.find('.sim-pdu-list').text()).toContain('Successful')
  expect(wrapper.find('.sim-auto-play').attributes('aria-pressed')).toBe('false')
})
it('network changes reset stale PDUs and TTL failures expose the drop reason', async () => {
  await start(); await queue(); await finish()
  const moved = topology(); moved.nodes[0].position = { x: 500, y: 250 }
  await wrapper.setProps({ topology: moved })
  expect(wrapper.find('.sim-pdu-list').text()).toContain('Successful')
  const changed = topology(); changed.edges[1].status = 'inactive'
  await wrapper.setProps({ topology: changed })
  expect(wrapper.find('.sim-pdu-list tbody').text()).toBe('')
  await queue(); await finish()
  expect(wrapper.find('.sim-pdu-list').text()).toContain('Failed')
  expect(wrapper.find('.sim-drop-reason').text()).toContain('No active topology path')
  expect(wrapper.emitted('packets').at(-1)[0][0].failed).toBe(true)
})
it('ready scenarios auto play in Realtime and preserve a custom service port', async () => {
  let nextFrame = null, now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', callback => { nextFrame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => { nextFrame = null })
  const installed = instantiateTemplate(presetProjects.find(p => p.id === 'server-rack'), 'component')
  wrapper = mount(SimulatorPanel, { props: { topology: installed, scenarios: installed.info.scenarios, initialMode: 'Realtime' } })
  await wrapper.find('select[aria-label="Ready scenario"]').setValue('rack-db-test')
  expect(wrapper.find('input[aria-label="PDU destination port"]').element.value).toBe('5432')
  await wrapper.find('.sim-run-scenario').trigger('click')
  expect(wrapper.find('.sim-auto-play').text()).toContain('Pause')
  for (let i = 0; i < 500 && nextFrame; i++) { const callback = nextFrame; nextFrame = null; now += 100; callback(now); await flushPromises() }
  expect(wrapper.find('.sim-pdu-list tbody').text()).toContain('Successful')
  expect(wrapper.find('.sim-pdu-list tbody').text()).toContain('App → DB')
  const received = wrapper.findAll('.sim-event-info').find(b => b.text() === 'TCP · Received')
  await received.trigger('click')
  await wrapper.findAll('.sim-detail-tabs button').find(b => b.text() === 'Inbound PDU Details').trigger('click')
  expect(wrapper.find('.sim-header-fields').text()).toContain('5432')
})
it('WAN failure scenario produces Failed without changing the saved link status', async () => {
  const installed = instantiateTemplate(presetProjects.find(p => p.id === 'branch-hq'), 'component')
  wrapper = mount(SimulatorPanel, { props: { topology: installed, scenarios: installed.info.scenarios } })
  await wrapper.find('select[aria-label="Ready scenario"]').setValue('wan-failure')
  await wrapper.find('.sim-run-scenario').trigger('click'); await finish()
  expect(wrapper.find('.sim-pdu-list tbody').text()).toContain('Failed')
  expect(wrapper.find('.sim-drop-reason').text()).toContain('No active topology path')
  expect(installed.edges.find(e => e.id === 'wan-link-component').status).toBe('active')
  await wrapper.find('.sim-reset').trigger('click')
  await wrapper.find('select[aria-label="Ready scenario"]').setValue('branch-ping')
  await wrapper.find('.sim-run-scenario').trigger('click'); await finish()
  expect(wrapper.find('.sim-pdu-list tbody').text()).toContain('Successful')
})
it('the pinned Pause and Resume controls halt Realtime at the current packet and continue the same PDU', async () => {
  const clock = playbackClock()
  await start(); await wrapper.find('.sim-mode-tabs button').trigger('click'); await queue()
  await clock.frames(10)
  const staleCallback = clock.callbacks.values().next().value
  await wrapper.find('.sim-control-dock .sim-pause-resume').trigger('click')
  expect(clock.callbacks.size).toBe(0)
  const packet = wrapper.emitted('packets').at(-1), capturedCount = wrapper.findAll('.sim-event-info').length
  expect(wrapper.find('.sim-transport').text()).toContain('Paused')
  await clock.frames(30)
  expect(wrapper.emitted('packets').at(-1)).toEqual(packet)
  expect(wrapper.findAll('.sim-event-info')).toHaveLength(capturedCount)
  await wrapper.find('.sim-pause-resume').trigger('click')
  staleCallback(2000); await flushPromises()
  expect(wrapper.emitted('packets').at(-1)).toEqual(packet)
  expect(clock.callbacks.size).toBe(1)
  await clock.frames(250)
  expect(wrapper.find('.sim-pdu-list tbody').text()).toContain('Successful')
  expect(wrapper.find('.sim-pdu-list tbody').findAll('tr')).toHaveLength(1)
})
it('Stop cancels Realtime and clears the queue, and closing cancels all animation before unmount', async () => {
  const clock = playbackClock()
  await start(); await wrapper.find('.sim-mode-tabs button').trigger('click'); await queue(); await clock.frames(10)
  const staleCallback = clock.callbacks.values().next().value
  await wrapper.find('.sim-control-dock .sim-stop').trigger('click')
  expect(clock.callbacks.size).toBe(0)
  expect(wrapper.emitted('packets').at(-1)[0]).toEqual([])
  expect(wrapper.find('.sim-pdu-list tbody').text()).toBe('')
  expect(wrapper.findAll('.sim-event-info')).toHaveLength(0)
  expect(wrapper.find('.sim-transport').text()).toContain('Idle')
  await queue()
  staleCallback(2000); await flushPromises()
  expect(wrapper.emitted('packets').at(-1)[0]).toEqual([])
  expect(clock.callbacks.size).toBe(1)
  await clock.frames(10)
  await wrapper.find('button[aria-label="Close Simulator"]').trigger('click')
  expect(clock.callbacks.size).toBe(0)
  expect(wrapper.emitted('close')).toHaveLength(1)
  expect(wrapper.emitted('packets').at(-1)[0]).toEqual([])
  wrapper.unmount(); wrapper = null
  expect(clock.callbacks.size).toBe(0)
})
it('a ready scenario with a deleted required link is disabled while manual PDU stays available', async () => {
  const installed = instantiateTemplate(presetProjects.find(p => p.id === 'branch-hq'), 'missing-edge')
  installed.edges = installed.edges.filter(e => e.id !== 'wan-link-missing-edge')
  wrapper = mount(SimulatorPanel, { props: { topology: installed, scenarios: installed.info.scenarios } })
  await wrapper.find('select[aria-label="Ready scenario"]').setValue('wan-failure')
  expect(wrapper.find('.sim-run-scenario').attributes('disabled')).toBeDefined()
  expect(wrapper.find('.sim-ready-scenarios').text()).toContain('อุปกรณ์หรือสาย')
  expect(wrapper.find('.sim-add-pdu').attributes('disabled')).toBeUndefined()
})
