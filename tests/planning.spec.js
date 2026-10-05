import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import PlanningWorkspace from '../src/client/PlanningWorkspace.vue'
import { calculatePlan, scalePlan } from '../src/server/lib/planning.js'
let wrapper
afterEach(() => wrapper?.unmount())
const initial = () => ({ parent: '10.44.0.0/24', segments: [{ id: 'hq', name: 'HQ', site: 'HQ', department: 'IT', vlan: 10, hosts: 50, growth: 0, reservedCount: 2 }], assignments: [] })
async function start(role = 'owner') {
  const request = vi.fn(async (url, options = {}) => {
    if (url.endsWith('/calculate')) return { design: calculatePlan(JSON.parse(options.body)) }
    if (url.endsWith('/scale')) { const body = JSON.parse(options.body); return scalePlan(body.input, body.changes) }
    if (url.endsWith('/probes')) return { probes: [] }
    if (url.endsWith('/verification')) return { observations: [], jobs: [], comparison: { findings: [], utilization: [], freshCount: 0, staleCount: 0 } }
    if (options.method === 'PUT') { const body = JSON.parse(options.body); return { plan: { revision: body.revision + 1, input: body.input, design: calculatePlan(body.input) } } }
    return { plan: { revision: 1, input: initial(), design: calculatePlan(initial()) } }
  })
  wrapper = mount(PlanningWorkspace, { props: { roomId: 'room-1', sessionId: 'owner-session', role, request, nodes: [] } })
  await flushPromises()
  return request
}
async function step(i) { await wrapper.findAll('.planning-steps button')[i].trigger('click'); await flushPromises() }
it('calculates a changed requirement and saves it with the plan revision', async () => {
  const request = await start()
  await wrapper.find('input[aria-label="Hosts"]').setValue(150)
  await wrapper.find('.planning-footer .primary-action').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('10.44.0.0/24')
  expect(wrapper.text()).toContain('Passed')
  await wrapper.find('.planning-heading .primary-action').trigger('click'); await flushPromises()
  const saved = request.mock.calls.find(([, options]) => options.method === 'PUT')
  expect(JSON.parse(saved[1].body).revision).toBe(1)
  expect(JSON.parse(saved[1].body).input.segments[0].hosts).toBe(150)
  expect(wrapper.text()).toContain('Plan r2')
})
it('what-if compares 50 to 150 and applies only the compared snapshot to the draft', async () => {
  const request = await start()
  await step(2)
  await wrapper.find('.planning-scale-inputs input').setValue(150)
  await wrapper.find('.planning-surface > .primary-action').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('Subnet เดิมไม่พอ')
  expect(wrapper.text()).toContain('reallocate')
  await wrapper.find('.planning-scale-inputs input').setValue(200)
  await wrapper.find('.planning-surface > .secondary-action').trigger('click'); await flushPromises()
  await step(0)
  expect(wrapper.find('input[aria-label="Hosts"]').element.value).toBe('150')
  expect(request.mock.calls.some(([, o]) => o.method === 'PUT')).toBe(false)
})
it('IPAM catches duplicated and out-of-subnet assignments', async () => {
  await start()
  await step(3)
  for (let index = 0; index < 2; index++) {
    await wrapper.find('fieldset > .secondary-action').trigger('click')
    await wrapper.findAll('input[aria-label="Planned IP"]')[index].setValue('10.44.1.5')
  }
  await wrapper.find('.planning-footer .primary-action').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('DUPLICATE_IP')
  expect(wrapper.text()).toContain('OUTSIDE_SUBNET')
})
it('viewers cannot save, edit IPAM, enroll probes or run network jobs', async () => {
  await start('viewer')
  expect(wrapper.find('.planning-heading .primary-action').attributes('disabled')).toBeDefined()
  expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined()
  await step(3); expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined()
  await step(4)
  expect(wrapper.find('.planning-enroll').exists()).toBe(false)
  expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined()
})
it('probe job queueing shows actual coverage and displays live findings', async () => {
  const request = await start()
  request.mockImplementation(async (url, options = {}) => {
    if (url.endsWith('/probes')) return { probes: [{ id: 'probe-1', name: 'HQ probe', network: '10.44.0.0/26', segmentId: 'hq', online: true }] }
    if (url.endsWith('/jobs')) return { coverage: 62, totalUsable: 62, offset: 0 }
    if (url.endsWith('/verification')) return { observations: [], jobs: [], comparison: { findings: [{ code: 'UNEXPECTED_DEVICE', ip: '10.44.0.20', message: 'Unplanned host' }], utilization: [], freshCount: 62, staleCount: 0 } }
    throw new Error('Unexpected route ' + url)
  })
  await step(4)
  await wrapper.find('.section-heading .quiet-button').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('UNEXPECTED_DEVICE')
  await wrapper.find('fieldset .primary-action').trigger('click'); await flushPromises()
  const queued = request.mock.calls.find(([url]) => url.endsWith('/probe-1/jobs'))
  expect(JSON.parse(queued[1].body)).toMatchObject({ kind: 'scan', offset: 0 })
  expect(wrapper.text()).toContain('62/62 usable IPs')
})
