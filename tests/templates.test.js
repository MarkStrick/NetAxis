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
