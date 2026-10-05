import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateSubnet } from '../src/server/lib/subnet.js'
import { parseOrThrow, deviceDataSchema, edgeSchema } from '../src/server/lib/validation.js'

test('calculates IPv4 subnet details', () => {
  assert.deepEqual(calculateSubnet('192.168.10.42', 24), {
    input: '192.168.10.42/24',
    networkAddress: '192.168.10.0',
    broadcastAddress: '192.168.10.255',
    subnetMask: '255.255.255.0',
    firstUsable: '192.168.10.1',
    lastUsable: '192.168.10.254',
    hostCount: 254,
  })
  assert.equal(calculateSubnet('192.168.10.42', 33), null)
})

test('validates network identity fields', () => {
  assert.doesNotThrow(() => parseOrThrow(deviceDataSchema, { ipv4: '10.0.0.1', cidr: 24, mac: 'AA-BB-CC-DD-EE-FF', vlan: '20', status: 'online' }))
  assert.throws(() => parseOrThrow(deviceDataSchema, { ipv4: '10.0.0.999', cidr: 24 }), /IPv4 address is invalid/)
  assert.throws(() => parseOrThrow(deviceDataSchema, { ipv4: '10.0.0.1' }), /CIDR is required/)
  assert.throws(() => parseOrThrow(deviceDataSchema, { vlan: '4095' }), /VLAN must be between 1 and 4094/)
})

test('prevents self-referencing links', () => {
  assert.throws(() => parseOrThrow(edgeSchema, { sourceNodeId: 'node_a', targetNodeId: 'node_a', medium: 'ethernet', status: 'unknown' }), /different nodes/)
})

test('validates IPv6 addresses and prefixes including embedded IPv4', () => {
  for (const ipv6 of ['::1', '2001:db8::10/64', '::ffff:192.0.2.1/128']) assert.doesNotThrow(() => parseOrThrow(deviceDataSchema, { ipv6 }))
  for (const ipv6 of [':::::', '1:2:3', '2001:db8::/129', '::/abc', '2001:db8::/64/10']) assert.throws(() => parseOrThrow(deviceDataSchema, { ipv6 }), /IPv6 address is invalid/)
})
