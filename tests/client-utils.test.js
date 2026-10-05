import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { clone, findRoute, csvCell } from '../src/client/lib/topology.js'
import { calculateSubnet } from '../src/server/lib/subnet.js'

test('clones Vue reactive topology without DataCloneError or shared state', () => {
  const original = reactive({ nodes: [{ data: { vlan: '10' } }], edges: [] })
  const copy = clone(original)
  copy.nodes[0].data.vlan = '20'
  assert.equal(original.nodes[0].data.vlan, '10')
})
test('simulation finds an active route and respects offline devices and inactive links', () => {
  const topology = { nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, data: { status: 'online' } })), edges: [{ id: 'ab', sourceNodeId: 'a', targetNodeId: 'b', status: 'active' }, { id: 'bc', sourceNodeId: 'b', targetNodeId: 'c', status: 'active' }, { id: 'ad', sourceNodeId: 'a', targetNodeId: 'd', status: 'active' }, { id: 'dc', sourceNodeId: 'd', targetNodeId: 'c', status: 'active' }] }
  assert.deepEqual(findRoute(topology, 'a', 'c').edgeIds, ['ab', 'bc'])
  topology.nodes[1].data.status = 'offline'
  assert.deepEqual(findRoute(topology, 'a', 'c').edgeIds, ['ad', 'dc'])
  topology.edges[3].status = 'inactive'
  assert.equal(findRoute(topology, 'a', 'c'), null)
  assert.equal(findRoute(topology, 'a', 'a'), null)
  assert.equal(findRoute(topology, 'missing', 'c'), null)
})
test('CSV protects formulas, preserves quoted text and CIDR zero', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.com")'), '"\'=HYPERLINK(""https://example.com"")"')
  assert.equal(csvCell('a,b\nc'), '"a,b\nc"')
  assert.equal(csvCell(0), '"0"')
})
test('subnet calculator validates syntax and supports /0, /31, /32', () => {
  for (const address of ['1..2.3', '1.2.3.', '01.2.3.4', '1e2.2.3.4']) assert.equal(calculateSubnet(address, 24), null)
  for (const prefix of ['', null, undefined, 24.5, 33]) assert.equal(calculateSubnet('10.0.0.1', prefix), null)
  assert.equal(calculateSubnet('10.0.0.1', 0).hostCount, 4294967294)
  assert.equal(calculateSubnet('10.0.0.1', 31).hostCount, 2)
  assert.equal(calculateSubnet('10.0.0.1', 32).hostCount, 1)
})
