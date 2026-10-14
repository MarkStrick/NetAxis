import test from 'node:test'
import assert from 'node:assert/strict'
import { presetProjects, instantiateTemplate, scenarioTopology } from '../src/shared/templates.js'
import { nodeSchema, edgeSchema } from '../src/server/lib/validation.js'
import { planSchema, calculatePlan } from '../src/server/lib/planning.js'
import { buildCiscoPdu as buildPdu } from '../src/client/lib/simulator.js'

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


test('all catalog labs use real models and CLI-generated config; compilation matches shipped ports/routes', async () => {
 const {compileLabs}=await import('../scripts/build-lab-templates.js')
 assert.deepEqual(compileLabs(),presetProjects)
 const {createCiscoLab}=await import('../src/client/lib/cisco-lab.js')
 const branch=instantiateTemplate(presetProjects[2],'cli-route'),engine=createCiscoLab(branch),router=branch.nodes.find(n=>n.label==='R-BRANCH')
 assert.match(engine.run(router.id,'ping 10.60.10.20').output,/100 percent/)
 for(const command of ['configure terminal','no ip route 10.60.10.0 255.255.255.0 10.60.255.1','end']) engine.run(router.id,command)
 assert.equal(buildPdu(engine.graph(),branch.info.scenarios[0]).outcome,'failed')
 for(const command of ['configure terminal','ip route 10.60.10.0 255.255.255.0 10.60.255.1','end']) engine.run(router.id,command)
 assert.equal(buildPdu(engine.graph(),branch.info.scenarios[0]).outcome,'success')

 const {hardwareModels}=await import('../src/shared/device-catalog.js')
 for(const preset of presetProjects) {
  assert.ok(preset.nodes.every(n=>hardwareModels.some(m=>m.id===n.data.model)))
  assert.ok(preset.nodes.filter(n=>['router','switch'].includes(n.type)).every(n=>n.data.cisco.commands.includes('write memory')))
  assert.ok(preset.scenarios.some(s=>s.expected==='success'));assert.ok(preset.scenarios.some(s=>s.expected==='failed'))
 }
 const t=instantiateTemplate(presetProjects[3],'services')
 for(const s of t.info.scenarios.filter(s=>s.expected==='success')) {
  const pdu=buildPdu(t,s)
  if(s.protocol==='TCP') {assert.ok(pdu.events.some(e=>e.frame.flags==='SYN'));assert.ok(pdu.events.some(e=>e.frame.flags==='SYN, ACK'))}
  if(s.protocol==='UDP') assert.ok(pdu.events.filter(e=>e.protocol==='UDP').every(e=>!e.frame.flags))
 }
})


import { templateBounds } from '../src/shared/templates.js'
test('template preview bounds include every real-hardware lab device', () => {
  for (const preset of presetProjects) {
    const b = templateBounds(preset)
    for (const n of preset.nodes) {
      assert.ok(n.position.x > b.x && n.position.x + 144 < b.x + b.width)
      assert.ok(n.position.y > b.y && n.position.y + 68 < b.y + b.height)
    }
  }
})

test('presentation workspace files restore with the same CLI configuration and scenario results', async () => {
 const {readFile}=await import('node:fs/promises'),{parseWorkspace}=await import('../src/server/lib/workspace-schema.js')
 for(const preset of presetProjects) {
  const workspace=parseWorkspace(JSON.parse(await readFile(new URL('../demos/'+preset.id+'.json',import.meta.url),'utf8')))
  assert.deepEqual(workspace.nodes.map(n=>n.data.cisco),preset.nodes.map(n=>n.data.cisco))
  for(const s of workspace.template.scenarios) assert.equal(buildPdu(scenarioTopology(workspace,s),s).outcome,s.expected,s.name)
 }
})

test('firewall lab supports PC and router ping; denied traffic fails at the firewall', async () => {
 const {createCiscoLab}=await import('../src/client/lib/cisco-lab.js')
 const preset=presetProjects.find(p=>p.id==='cisco-firewall-demo'),lab=createCiscoLab(preset)
 assert.match(lab.run('fw-users','ping 10.80.20.20',false).output,/100 percent/)
 lab.run('fw-router','enable')
 assert.match(lab.run('fw-router','ping 10.80.20.20').output,/100 percent/)
 assert.match(lab.run('fw-guest','ping 10.80.20.20').output,/ACL blocked ICMP at FW/)
 for(const scenario of preset.scenarios.filter(s=>s.id.endsWith('deny'))) {
  const pdu=buildPdu(preset,scenario)
  assert.equal(pdu.outcome,'failed')
  assert.match(pdu.reason,/ACL blocked .* at FW/)
 }
 const noReturn=structuredClone(preset)
 noReturn.nodes.find(n=>n.id==='fw-gateway').data.cisco.routes=[]
 assert.match(buildPdu(noReturn,preset.scenarios[0]).reason,/No route/)
})
