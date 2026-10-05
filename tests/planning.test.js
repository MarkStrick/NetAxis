import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePlan, scalePlan, compareObserved, privateCidr, planSchema } from '../src/server/lib/planning.js'
import { runProbeJob, ping } from '../scripts/probe-agent.js'

const segment = (id, hosts, extra = {}) => ({ id, name: id, site: 'HQ', department: 'IT', vlan: id === 'a' ? 10 : 20, hosts, growth: 0, reservedCount: 2, ...extra })
const input = (segments, assignments = []) => ({ parent: '10.0.0.0/24', segments, assignments })
test('VLSM allocates largest blocks first with aligned ranges and reserved/gateway capacity', () => {
  const plan = calculatePlan(input([segment('a', 20), segment('b', 100)]))
  assert.equal(plan.segments[1].cidr, '10.0.0.0/25')
  assert.equal(plan.segments[0].cidr, '10.0.0.128/27')
  assert.equal(plan.segments[0].broadcast, '10.0.0.159')
  assert.equal(plan.segments[0].gateway, '10.0.0.129')
  assert.deepEqual(plan.segments[0].reservedIps, ['10.0.0.130', '10.0.0.131'])
  assert.equal(plan.segments[0].usableCapacity, 27)
  assert.equal(plan.segments[0].wasted, 7)
  assert.deepEqual(plan.issues, [])
})
test('automatic allocation avoids manually pinned subnets and reports exhausted parent space', () => {
  const plan = calculatePlan(input([segment('a', 20, { cidr: '10.0.0.0/27' }), segment('b', 100)]))
  assert.equal(plan.segments[1].cidr, '10.0.0.128/25')
  assert.deepEqual(plan.issues, [])
  const exhausted = calculatePlan(input([segment('a', 200), segment('b', 100)]))
  assert.equal(exhausted.segments[1].cidr, '')
  assert.ok(exhausted.issues.some(i => i.code === 'PARENT_CAPACITY'))
})
test('growth can force a larger subnet and 50 to 150 hosts flags resizing without mutating input', () => {
  const original = input([segment('a', 50)])
  const scaled = scalePlan(original, { a: 150 })
  assert.equal(scaled.comparison[0].before, '10.0.0.0/26')
  assert.equal(scaled.comparison[0].after, '10.0.0.0/24')
  assert.equal(scaled.comparison[0].oldSubnetInsufficient, true)
  assert.equal(scaled.comparison[0].action, 'reallocate')
  assert.equal(original.segments[0].hosts, 50)
  assert.equal(calculatePlan(input([segment('a', 50, { growth: 100 })])).segments[0].cidr, '10.0.0.0/25')
})
test('design validation covers overlaps, duplicate IP/gateway, outside IPs, broadcast and reserved conflicts', () => {
  const plan = calculatePlan(input([
    segment('a', 100, { cidr: '10.0.0.0/26', gateway: '10.0.0.1', reservedIps: ['10.0.0.2'] }),
    segment('b', 5, { cidr: '10.0.0.0/27', gateway: '10.0.0.1' }),
  ], [
    { segmentId: 'a', ip: '10.0.0.2', kind: 'device' },
    { segmentId: 'a', ip: '10.0.0.2', kind: 'server' },
    { segmentId: 'a', ip: '10.0.1.10', kind: 'device' },
    { segmentId: 'a', ip: '10.0.0.63', kind: 'device' },
    { segmentId: 'gone', ip: '10.0.0.5', kind: 'device' },
  ]))
  for (const code of ['OVERLAP', 'CAPACITY', 'DUPLICATE_IP', 'RESERVED_CONFLICT', 'OUTSIDE_SUBNET', 'NETWORK_BROADCAST_USED', 'UNKNOWN_SEGMENT']) assert.ok(plan.issues.some(i => i.code === code), code)
  assert.equal(planSchema.safeParse(input([segment('a', -1)])).success, false)
  assert.equal(planSchema.safeParse(input([segment('a', 10), segment('a', 20)])).success, false)
  assert.equal(planSchema.safeParse({ parent: '10.0.0.0/99', segments: [segment('a', 1)] }).success, false)
})
test('live comparison reports unexpected, missing, reserved/MAC conflict, duplicates and stale evidence', () => {
  const plan = calculatePlan(input([segment('a', 50)], [
    { segmentId: 'a', ip: '10.0.0.10', kind: 'server', mac: '11:22:33:44:55:66' },
    { segmentId: 'a', ip: '10.0.0.2', kind: 'reserved', mac: '11:22:33:44:55:66' },
    { segmentId: 'a', ip: '10.0.0.11', kind: 'server' },
  ]))
  const receivedAt = new Date().toISOString(), old = new Date(Date.now() - 360_000).toISOString()
  const rows = [
    { ip: '10.0.0.20', reachable: true, mac: 'aa:bb:cc:dd:ee:ff', receivedAt },
    { ip: '10.0.0.2', reachable: true, mac: 'aa:bb:cc:dd:ee:ff', receivedAt },
    { ip: '10.0.0.10', reachable: true, mac: 'aa:bb:cc:dd:ee:ff', receivedAt },
    { ip: '10.0.0.10', reachable: true, mac: 'aa:bb:cc:dd:ee:00', receivedAt },
    { ip: '10.0.0.11', reachable: false, receivedAt },
    { ip: '10.0.0.30', reachable: true, receivedAt: old },
  ]
  const result = compareObserved(plan, rows)
  for (const code of ['UNEXPECTED_DEVICE', 'RESERVED_CONFLICT', 'MAC_MISMATCH', 'DUPLICATE_OBSERVED_IP', 'MISSING_UNREACHABLE']) assert.ok(result.findings.some(f => f.code === code), code)
  assert.equal(result.staleCount, 1)
  assert.equal(result.utilization[0].count, 3)
  assert.ok(!result.findings.some(f => f.ip === '10.0.0.30'))
  assert.ok(!compareObserved(plan, [{ ip: '10.0.0.11', reachable: false, probed: false, receivedAt }]).findings.some(f => f.code === 'MISSING_UNREACHABLE'))
  assert.ok(!compareObserved(plan, []).findings.some(f => f.code === 'MISSING_UNREACHABLE'))
})
test('capacity risk is based on unique fresh observed usable hosts', () => {
  const plan = calculatePlan(input([segment('a', 1, { reservedCount: 0 })]))
  const result = compareObserved(plan, [1, 2].map(ip => ({ ip: `10.0.0.${ip}`, reachable: true, receivedAt: new Date().toISOString() })))
  assert.ok(result.findings.some(f => f.code === 'CAPACITY_RISK'))
})
test('probe scope accepts RFC1918 only and rejects arbitrary targets before running commands', async () => {
  assert.equal(privateCidr('10.0.0.0/8'), true)
  assert.equal(privateCidr('172.16.0.0/12'), true)
  assert.equal(privateCidr('192.168.0.0/16'), true)
  assert.equal(privateCidr('172.0.0.0/8'), false)
  assert.equal(privateCidr('0.0.0.0/0'), false)
  await assert.rejects(runProbeJob({ kind: 'host', network: '10.0.0.0/24', targets: ['8.8.8.8'] }), /enrolled private subnet/)
  await assert.rejects(runProbeJob({ kind: 'host', network: '10.0.0.0/24', targets: ['127.0.0.1;whoami'] }), /enrolled private subnet/)
})
test('real local ping collector detects the loopback host', async () => {
  const result = await ping('127.0.0.1')
  assert.equal(result.reachable, true)
})
