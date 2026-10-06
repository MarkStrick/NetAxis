import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPdu, pduStatus, simulationRoute, simulationMac } from '../src/client/lib/simulator.js'

const node = (id, type, ipv4, extra = {}) => ({ id, label: id, type, position: { x: 0, y: 0 }, data: { ipv4, cidr: 24, status: 'online', ...extra } })
const edge = (id, sourceNodeId, targetNodeId, status = 'active') => ({ id, sourceNodeId, targetNodeId, status })
const lan = () => ({ nodes: [node('a', 'pc', '10.0.0.10'), node('s', 'switch', '10.0.0.1'), node('b', 'server', '10.0.0.20'), node('c', 'pc', '10.0.0.30')], edges: [edge('as', 'a', 's'), edge('sb', 's', 'b'), edge('sc', 's', 'c')] })
const options = protocol => ({ source: 'a', target: 'b', protocol, ttl: 64, destinationPort: 80, payloadBytes: 32 })
test('Simple PDU floods ARP to the LAN, learns addresses and completes an ICMP round trip', () => {
  const pdu = buildPdu(lan(), options('ICMP'))
  assert.equal(pdu.outcome, 'success')
  assert.ok(pdu.events.some(e => e.toId === 'c' && e.action === 'ARP ignored (not target)'))
  const request = pdu.events.find(e => e.action === 'ARP request received')
  assert.equal(request.frame.destinationMac, 'ff:ff:ff:ff:ff:ff')
  assert.equal(request.frame.protocol, 'ARP')
  assert.ok(pdu.events.some(e => e.action === 'ARP resolved'))
  const echo = pdu.events.filter(e => e.protocol === 'ICMP' && e.action === 'Received')
  assert.deepEqual(echo.map(e => e.frame.operation), ['Echo Request (type 8)', 'Echo Reply (type 0)'])
  assert.deepEqual(echo.map(e => [e.frame.sourceIp, e.frame.destinationIp]), [['10.0.0.10', '10.0.0.20'], ['10.0.0.20', '10.0.0.10']])
  assert.equal(pdu.events.at(-1).toId, 'a')
  assert.equal(pdu.events.at(-1).terminal, 'success')
  assert.equal(pduStatus(pdu, new Set()), 'Pending')
  assert.equal(pduStatus(pdu, new Set([pdu.events[0].id])), 'In progress')
  assert.equal(pduStatus(pdu, new Set(pdu.events.map(e => e.id))), 'Successful')
  assert.deepEqual(pdu.events.find(e => e.action === 'Frame forwarded').frame.ttl, 64)
})
test('warm ARP cache avoids repeated resolution, while explicit ARP still sends a request', () => {
  const first = buildPdu(lan(), options('ICMP')), cache = new Set(first.cache)
  const second = buildPdu(lan(), options('ICMP'), { cache, id: 'pdu-2' })
  assert.equal(second.events.some(e => e.protocol === 'ARP'), false)
  assert.ok(buildPdu(lan(), options('ARP'), { cache }).events.some(e => e.action === 'ARP request received'))
  assert.deepEqual(cache, first.cache)
})
test('TCP models SYN, SYN-ACK, ACK, data and acknowledgment with consistent sequence fields', () => {
  const pdu = buildPdu(lan(), options('TCP'))
  const received = pdu.events.filter(e => e.protocol === 'TCP' && e.action === 'Received')
  assert.deepEqual(received.map(e => e.frame.flags), ['SYN', 'SYN, ACK', 'ACK', 'PSH, ACK', 'ACK'])
  assert.equal(received[1].frame.ack, 1001)
  assert.equal(received.at(-1).frame.ack, 1033)
  assert.equal(received[0].frame.destinationPort, 80)
  assert.equal(received[1].frame.sourcePort, 80)
  assert.equal(pdu.outcome, 'success')
})
test('UDP delivers one datagram without inventing a return acknowledgment', () => {
  const pdu = buildPdu(lan(), options('UDP'))
  const received = pdu.events.filter(e => e.protocol === 'UDP' && e.action === 'Received')
  assert.equal(received.length, 1)
  assert.equal(received[0].toId, 'b')
  assert.equal(pdu.outcome, 'success')
})
test('router forwarding reduces TTL, rewrites Ethernet MACs and stops on TTL expiration', () => {
  const topology = { nodes: [node('a', 'pc', '10.0.0.10'), node('r', 'router', '10.0.0.1'), node('b', 'server', '10.0.1.20')], edges: [edge('ar', 'a', 'r'), edge('rb', 'r', 'b')] }
  const expired = buildPdu(topology, { ...options('ICMP'), ttl: 1 })
  assert.equal(expired.outcome, 'failed')
  assert.match(expired.reason, /TTL expired/)
  assert.equal(expired.events.at(-1).toId, 'r')
  assert.deepEqual(expired.events.at(-1).outbound, [])
  const forwarded = buildPdu(topology, { ...options('ICMP'), ttl: 2 })
  assert.equal(forwarded.outcome, 'success')
  const hop = forwarded.events.find(e => e.action === 'IPv4 forwarded')
  assert.equal(hop.frame.ttl, 2)
  assert.equal(hop.outboundFrame.ttl, 1)
  assert.equal(hop.outboundFrame.sourceMac, simulationMac(topology.nodes[1]))
  assert.equal(hop.outboundFrame.destinationMac, simulationMac(topology.nodes[2]))
  assert.match(buildPdu(topology, options('ARP')).reason, /Layer 2/)
})
test('simulation rejects offline/inactive paths, host transit, invalid IPs, VLAN and subnet mismatch', () => {
  let t = lan(); t.edges[1].status = 'inactive'
  assert.equal(buildPdu(t, options('ICMP')).outcome, 'failed')
  t = lan(); t.nodes[2].data.status = 'offline'
  assert.equal(buildPdu(t, options('ICMP')).outcome, 'failed')
  t = lan(); t.nodes[1].type = 'pc'
  assert.equal(simulationRoute(t, 'a', 'b'), null)
  t = lan(); t.nodes[2].data.ipv4 = '10.1.0.20'
  assert.match(buildPdu(t, options('ICMP')).reason, /Different subnets/)
  t = lan(); t.nodes[0].data.vlan = '10'; t.nodes[2].data.vlan = '20'
  assert.match(buildPdu(t, options('ICMP')).reason, /VLAN/)
  t = lan(); t.nodes[0].data.ipv4 = ''
  assert.match(buildPdu(t, options('ICMP')).reason, /Configure IPv4/)
  t = lan(); t.nodes[0].data.ipv4 = '10.0.0.255'
  assert.match(buildPdu(t, options('ICMP')).reason, /network\/broadcast/)
  assert.equal(buildPdu(lan(), { ...options('ICMP'), ttl: 0 }).outcome, 'failed')
  assert.equal(buildPdu(lan(), { ...options('ICMP'), target: 'missing' }).outcome, 'failed')
})
test('generated MAC addresses are explicitly marked as simulated and do not mutate topology', () => {
  const topology = lan(), snapshot = JSON.stringify(topology)
  const pdu = buildPdu(topology, options('ICMP'))
  assert.match(simulationMac(topology.nodes[0]), /^02:00:/)
  assert.equal(pdu.events[0].frame.syntheticMac, true)
  assert.ok(pdu.events[0].outbound.some(f => f.value.includes('not observed')))
  assert.equal(JSON.stringify(topology), snapshot)
  topology.nodes[0].data.mac = 'AA-BB-CC-DD-EE-FF'
  assert.equal(simulationMac(topology.nodes[0]), 'aa:bb:cc:dd:ee:ff')
})
