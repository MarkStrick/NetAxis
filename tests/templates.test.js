import test from 'node:test'
import assert from 'node:assert/strict'
import { presetProjects, instantiateTemplate, scenarioTopology } from '../src/shared/templates.js'
import { nodeSchema, edgeSchema } from '../src/server/lib/validation.js'
import { planSchema, calculatePlan } from '../src/server/lib/planning.js'
import { buildPdu } from '../src/client/lib/simulator.js'

for (const preset of presetProjects) test(`${preset.name}: addressing and every scenario match their expected outcome`, () => {
  const installed = instantiateTemplate(preset, 'validation')
  installed.nodes.forEach(n => nodeSchema.parse(n))
  installed.edges.forEach(e => edgeSchema.parse(e))
  assert.deepEqual(calculatePlan(planSchema.parse(installed.plan)).issues, [])
  const before = JSON.stringify(installed)
  for (const scenario of installed.info.scenarios) {
    const model = scenarioTopology(installed, scenario)
    const pdu = buildPdu(model, scenario)
    assert.equal(pdu.outcome, scenario.expected, `${scenario.name}: ${pdu.reason}`)
    if (scenario.id === 'rack-failover') {
      assert.ok(pdu.events.some(e => e.toId === 'rack-backup-validation'))
      assert.equal(pdu.events.some(e => e.route?.edgeIds?.includes('rack-primary-up-validation')), false)
    }
  }
  assert.equal(JSON.stringify(installed), before, 'fault scenarios must not change the saved topology')
  assert.ok(installed.plan.assignments.every(a => a.mac === ''), 'reference designs must not claim observed MACs')
})

test('copies have independent globally unique device/link identifiers', () => {
  const a = instantiateTemplate(presetProjects[2], 'room-a'), b = instantiateTemplate(presetProjects[2], 'room-b')
  const aIds = new Set([...a.nodes, ...a.edges].map(item => item.id))
  assert.ok([...b.nodes, ...b.edges].every(item => !aIds.has(item.id)))
  b.plan.segments[0].hosts = 999
  b.nodes[0].data.ipv4 = '10.0.0.1'
  assert.equal(a.plan.segments[0].hosts, 100)
  assert.equal(presetProjects[2].nodes[0].data.ipv4, '10.60.20.10')
})


test('advanced transport templates expose real transport differences and the campus fault selects the intended alternate path', () => {
  for (const id of ['tcp-service-lab', 'udp-service-lab', 'dual-campus-advanced']) {
    const t = instantiateTemplate(presetProjects.find(p => p.id === id), 'advanced')
    for (const s of t.info.scenarios.filter(s => s.expected === 'success')) {
      const pdu = buildPdu(scenarioTopology(t, s), s)
      const transport = pdu.events.filter(e => e.protocol === s.protocol)
      assert.ok(transport.length)
      if (s.protocol === 'TCP') { assert.ok(transport.some(e => e.frame.flags === 'SYN')); assert.ok(transport.some(e => e.frame.flags === 'SYN, ACK')); }
      if (s.protocol === 'UDP') { assert.ok(transport.every(e => !e.frame.flags)); assert.equal(pdu.events.at(-1).toId, s.target) }
      assert.ok(transport.filter(e => e.frame.destinationPort !== undefined).every(e => e.frame.destinationPort === s.destinationPort || e.frame.sourcePort === s.destinationPort))
    }
  }
  const t = instantiateTemplate(presetProjects.find(p => p.id === 'dual-campus-advanced'), 'advanced')
  assert.equal(t.nodes.filter(n => n.type === 'pc').length, 10)
  const s = t.info.scenarios.find(s => s.id === 'campus-logical-failover')
  const pdu = buildPdu(scenarioTopology(t, s), s)
  assert.ok(pdu.events.some(e => e.route?.edgeIds.includes('campus-gre-reference-advanced')))
  assert.equal(pdu.events.some(e => e.route?.edgeIds.includes('campus-wan-left-advanced')), false)
})


import { templateBounds } from '../src/shared/templates.js'
test('template preview bounds include both campuses and negative-coordinate Internet services', () => {
  for (const preset of presetProjects) {
    const b = templateBounds(preset)
    for (const n of preset.nodes) {
      assert.ok(n.position.x > b.x && n.position.x + 144 < b.x + b.width)
      assert.ok(n.position.y > b.y && n.position.y + 68 < b.y + b.height)
    }
  }
})
