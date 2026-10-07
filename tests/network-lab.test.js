import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPdu } from '../src/shared/simulator.js'
import { assertPortTopology, portsFor } from '../src/shared/devices.js'
import { validateNetwork, networkRoute, addressMatches } from '../src/shared/network.js'
import { parseWorkspace } from '../src/server/lib/workspace-schema.js'
import { nodeSchema, parseOrThrow } from '../src/server/lib/validation.js'
import { calculateIpv6, planIpv6, parseIpv6, formatIpv6 } from '../src/shared/ipv6.js'
import { changeCollaboration, collaborationSnapshot } from '../src/shared/collaboration.js'
const n = (id, type, ip, vlan = 10) => ({ id, type, label: id, position: { x: 0, y: 0 }, data: { model: type === 'pc' ? 'pc-default' : type === 'server' ? 'server-4' : type === 'router' ? 'router-4' : 'switch-24', ipv4: ip, cidr: 24, vlan: String(vlan), status: 'online' } })
const e = (id, a, b, sourcePort, targetPort) => ({ id, sourceNodeId: a, targetNodeId: b, sourcePort, targetPort, medium: 'ethernet', status: 'active' })
function lan() { return { nodes: [n('a', 'pc', '10.0.0.10'), n('s', 'switch', '10.0.0.1'), n('b', 'server', '10.0.0.20')], edges: [e('as', 'a', 's', 'Eth0', 'G0/0'), e('sb', 's', 'b', 'G0/1', 'Eth0')] } }
const request = protocol => ({ source: 'a', target: 'b', protocol, ttl: 64, destinationPort: 80, payloadBytes: 32 })
test('port capacity, unknown ports, duplicate connections and model/type compatibility are enforced', () => {
  const t = lan(); assertPortTopology(t)
  t.edges.push(e('ab', 'a', 'b', 'Eth0', 'Eth1')); assert.throws(() => assertPortTopology(t), /already connected/)
  t.edges.pop(); t.edges[0].sourcePort = 'G0/99'; assert.throws(() => assertPortTopology(t), /does not exist/)
  assert.throws(() => parseOrThrow(nodeSchema, { ...t.nodes[0], data: { ...t.nodes[0].data, model: 'router-4' } }), /Model/)
})
test('access and trunk memberships constrain both Ping and ARP; port shutdown stops forwarding', () => {
  const t = lan(); assert.equal(buildPdu(t, request('ICMP')).outcome, 'success')
  t.nodes[1].data.ports = portsFor(t.nodes[1]).map(p => p.id === 'G0/1' ? { ...p, vlan: 20 } : p)
  assert.equal(networkRoute(t, 'a', 'b'), null)
  assert.match(buildPdu(t, request('ICMP')).reason, /VLAN/)
  assert.ok(validateNetwork(t).some(i => i.edgeId === 'sb'))
  t.nodes[1].data.ports[1] = { ...t.nodes[1].data.ports[1], mode: 'trunk', allowedVlans: [10, 20] }
  assert.equal(buildPdu(t, request('ICMP')).outcome, 'success')
  t.nodes[1].data.ports[1].allowedVlans = [20]
  assert.equal(buildPdu(t, request('ARP')).outcome, 'failed')
  t.nodes[1].data.ports[1].allowedVlans = [10]; t.nodes[1].data.ports[1].status = 'down'
  assert.equal(buildPdu(t, request('TCP')).outcome, 'failed')
})
test('HTTP executes handshake, GET and response; ACL denies stop at the blocking device with no reply', () => {
  const t = lan(), first = buildPdu(t, request('HTTP'))
  assert.equal(first.outcome, 'success'); assert.ok(first.events.some(e => e.frame.operation === 'HTTP 200 OK'))
  t.nodes[1].data.acl = [{ action: 'deny', protocol: 'HTTP', source: 'any', destination: 'any' }]
  const blocked = buildPdu(t, request('HTTP'))
  assert.equal(blocked.outcome, 'failed'); assert.equal(blocked.events.at(-1).toId, 's')
  assert.match(blocked.reason, /ACL blocked/); assert.deepEqual(blocked.events.at(-1).outbound, [])
  assert.ok(!blocked.events.some(e => e.frame.operation === 'HTTP 200 OK'))
  t.nodes[1].data.acl.unshift({ action: 'allow', protocol: 'TCP', source: '10.0.0.0/24', destination: '10.0.0.0/24' })
  assert.equal(buildPdu(t, request('HTTP')).outcome, 'success')
  t.nodes[2].data.services = { http: false, tcpPorts: [443], udpPorts: [53] }
  assert.match(buildPdu(t, request('HTTP')).reason, /closed/)
  assert.equal(buildPdu(t, { ...request('TCP'), destinationPort: 443 }).outcome, 'success')
  assert.equal(buildPdu(t, { ...request('UDP'), destinationPort: 53 }).outcome, 'success')
  assert.equal(buildPdu(t, { ...request('UDP'), destinationPort: 54 }).outcome, 'failed')
})
test('return traffic is separately checked against stateless ACLs', () => {
  const t = lan(); t.nodes[1].data.acl = [{ action: 'deny', protocol: 'ICMP', source: '10.0.0.20', destination: 'any' }]
  const pdu = buildPdu(t, request('ICMP'))
  assert.equal(pdu.outcome, 'failed')
  assert.ok(pdu.events.some(e => e.action === 'Received' && e.toId === 'b'))
  assert.equal(pdu.events.at(-1).frame.operation, 'Echo Reply (type 0)')
})
test('a source ACL blocks at the source without animating a hop or receiving a reply', () => {
  const t = lan(); t.nodes[0].data.acl = [{ action: 'deny', protocol: 'ICMP', source: 'any', destination: 'any' }]
  const pdu = buildPdu(t, request('ICMP')), last = pdu.events.at(-1)
  assert.equal(pdu.outcome, 'failed'); assert.equal(last.fromId, 'a'); assert.equal(last.toId, 'a')
  assert.deepEqual(last.outbound, []); assert.ok(!pdu.events.some(event => event.frame.operation === 'Echo Reply (type 0)'))
  assert.equal(addressMatches('10.0.0.0/24/1', '10.0.0.10'), false)
  assert.equal(addressMatches('10.0.0.0/2e1', '10.0.0.10'), false)
})
test('L3 VLAN forwarding succeeds with reachable gateway and fails when a configured gateway is wrong', () => {
  const t = { nodes: [n('a','pc','10.0.0.10',10),n('r','router','10.0.0.1',10),n('b','server','10.0.1.20',20)], edges: [e('ar','a','r','Eth0','G0/0'),e('rb','r','b','G0/1','Eth0')] }
  t.nodes[0].data.gateway = '10.0.0.1'
  t.nodes[1].data.ports = portsFor(t.nodes[1]).map(p => ({ ...p, vlan: p.id === 'G0/1' ? 20 : 10 }))
  assert.equal(buildPdu(t, request('ICMP')).outcome, 'success')
  t.nodes[2].data.gateway = '10.0.1.250'
  assert.equal(buildPdu(t, request('UDP')).outcome, 'success') // One-way receipt does not require a return gateway.
  assert.match(buildPdu(t, request('ICMP')).reason, /gateway/)
  delete t.nodes[2].data.gateway
  t.nodes[0].data.gateway = '10.0.0.250'
  assert.match(buildPdu(t, request('ICMP')).reason, /gateway/)
  assert.ok(validateNetwork(t).some(i => /gateway/.test(i.message)))
})
test('IPv6 exact arithmetic supports compressed/embedded addresses, /0 and /128 and refuses overflow', () => {
  assert.equal(formatIpv6(parseIpv6('2001:db8:0:0:0:0:0:1')), '2001:db8::1')
  assert.equal(formatIpv6(parseIpv6('::ffff:192.0.2.1')), '::ffff:c000:201')
  assert.equal(calculateIpv6('::/0').addresses, (2n ** 128n).toString())
  assert.equal(calculateIpv6('2001:db8::1/128').last, '2001:db8::1')
  const p = planIpv6('2001:db8:1234:ffff::/48',64,3)
  assert.equal(p.network,'2001:db8:1234::/48'); assert.equal(p.subnets[2].cidr,'2001:db8:1234:2::/64')
  assert.equal(p.addressesPerSubnet,'18446744073709551616')
  assert.throws(() => planIpv6('2001:db8::/64',64,2), /พื้นที่/)
  for (const invalid of ['1::2::3',':1:2:3:4:5:6:7','2001:gg::','::ffff:192.0.2.999','2001:db8::/129']) assert.equal(calculateIpv6(invalid + (invalid.includes('/') ? '' : '/64')),null)
})
test('workspace round trips model, ports, ACL, jobs, services and saved IPv6 planning', () => {
  const t = lan(); t.nodes[1].data.acl = [{ action:'deny',protocol:'HTTP',source:'any',destination:'any' }]
  t.nodes[1].data.job = { title:'Configure VLANs',assignee:'u1',assigneeName:'Engineer',status:'doing' }
  const value = { format:'netaxis-workspace',version:1,room:{name:'Lab'},...t,template:null,plan:{parent:'10.0.0.0/24',segments:[{id:'v10',name:'Users',vlan:10,hosts:10}],ipv6:{parent:'2001:db8::/48',prefix:64,count:3}} }
  const parsed = parseWorkspace(JSON.parse(JSON.stringify(value)))
  assert.equal(parsed.edges[0].sourcePort,'Eth0'); assert.equal(parsed.nodes[1].data.job.assigneeName,'Engineer')
  assert.equal(parsed.plan.ipv6.count,3); assert.equal(parsed.nodes[1].data.acl[0].protocol,'HTTP')
})
test('collaboration isolates signaling, expires previews, validates roles/revisions and leaves topology untouched', () => {
  const t = { ...lan(),room:{revision:1} }, member = { id:'owner',role:'owner',displayName:'Owner' }, guest = { id:'guest',role:'viewer',displayName:'Guest' }, before = JSON.stringify(t)
  let state = changeCollaboration(null, member,{action:'move',nodeId:'a',position:{x:30,y:60},revision:1},t,1000)
  assert.equal(collaborationSnapshot(state,'guest',0,1500).moves[0].position.x,30)
  assert.equal(collaborationSnapshot(state,'guest',0,3001).moves.length,0)
  assert.throws(() => changeCollaboration(state,guest,{action:'move',nodeId:'a',position:{x:1,y:1},revision:1},t,1001),/Viewer/)
  assert.throws(() => changeCollaboration(state,member,{action:'move',nodeId:'a',position:{x:1,y:1},revision:0},t,1001),/changed/)
  state = changeCollaboration(state,member,{action:'voice-join'},t,1002); state = changeCollaboration(state,guest,{action:'voice-join'},t,1003)
  state = changeCollaboration(state,member,{action:'voice-signal',target:'guest',kind:'offer',sdp:'test offer'},t,1004)
  assert.equal(collaborationSnapshot(state,'owner',0,1005).signals.length,0)
  assert.equal(collaborationSnapshot(state,'guest',0,1005).signals.length,1)
  assert.equal(collaborationSnapshot(state,'guest',1,1005).signals.length,0)
  assert.throws(() => changeCollaboration(state,member,{action:'voice-signal',target:'outsider',kind:'offer',sdp:'test'},t,1005),/both members/)
  state = changeCollaboration(state,guest,{action:'voice-leave'},t,1006)
  assert.equal(state.voice.length,1); assert.equal(state.signals.length,0); assert.equal(JSON.stringify(t),before)
})
