import { z } from 'zod'
import { ipv4ToInt, intToIpv4, calculateSubnet } from './subnet.js'
import { planIpv6 } from '../../shared/ipv6.js'

const ip = z.string().trim().refine(v => ipv4ToInt(v) !== null, 'Invalid IPv4')
const cidr = z.string().trim().refine(v => Boolean(parseCidr(v)), 'Invalid IPv4 CIDR')
export const planSchema = z.object({
  ipv6: z.object({ parent: z.string().max(80), prefix: z.number().int().min(0).max(128), count: z.number().int().min(1).max(100) }).superRefine((v, ctx) => { try { planIpv6(v.parent, v.prefix, v.count) } catch (error) { ctx.addIssue({ code: 'custom', message: error.message }) } }).optional(),
  parent: cidr,
  segments: z.array(z.object({
    id: z.string().min(1).max(80), name: z.string().trim().min(1).max(120),
    site: z.string().max(120).default(''), department: z.string().max(120).default(''),
    vlan: z.number().int().min(1).max(4094), hosts: z.number().int().min(1).max(10_000_000),
    growth: z.number().min(0).max(1000).default(20), reservedCount: z.number().int().min(0).max(4096).default(0),
    cidr: cidr.optional().or(z.literal('')), gateway: ip.optional().or(z.literal('')),
    reservedIps: z.array(ip).max(4096).default([]),
  })).min(1).max(100),
  assignments: z.array(z.object({
    segmentId: z.string().min(1).max(80), ip,
    kind: z.enum(['device', 'server', 'reserved', 'free']), label: z.string().max(120).default(''),
    mac: z.string().regex(/^([a-fA-F0-9]{2}[:-]){5}[a-fA-F0-9]{2}$/).optional().or(z.literal('')),
  })).max(4096).default([]),
}).superRefine((v, ctx) => {
  if (new Set(v.segments.map(s => s.id)).size !== v.segments.length) ctx.addIssue({ code: 'custom', message: 'Segment IDs must be unique', path: ['segments'] })
})
export function parseCidr(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+\.\d+\/(0|[1-9]\d?)$/.test(value)) return null
  const [address, prefix] = value.split('/')
  const details = calculateSubnet(address, Number(prefix))
  return details ? { ...details, prefix: Number(prefix), start: ipv4ToInt(details.networkAddress), end: ipv4ToInt(details.broadcastAddress), size: 2 ** (32 - Number(prefix)), cidr: `${details.networkAddress}/${Number(prefix)}` } : null
}
export function privateCidr(value) {
  const n = parseCidr(value)
  return Boolean(n && [['10.0.0.0/8'], ['172.16.0.0/12'], ['192.168.0.0/16']].some(([v]) => { const p = parseCidr(v); return n.start >= p.start && n.end <= p.end }))
}
export const contains = (network, address) => { const n = typeof network === 'string' ? parseCidr(network) : network; const value = ipv4ToInt(address); return Boolean(n && value !== null && value >= n.start && value <= n.end) }
export const normalizeMac = value => (value || '').toLowerCase().replaceAll('-', ':')
const required = s => Math.ceil(s.hosts * (1 + s.growth / 100))

export function calculatePlan(input) {
  const plan = planSchema.parse(input), parent = parseCidr(plan.parent)
  const occupied = plan.segments.filter(s => s.cidr).map(s => parseCidr(s.cidr))
  const segments = new Map()
  const ordered = plan.segments.map(s => {
    const demand = required(s), overhead = 1 + Math.max(s.reservedCount, s.reservedIps.length)
    const size = 2 ** Math.max(2, Math.ceil(Math.log2(demand + overhead + 2)))
    return { ...s, demand, overhead, size }
  }).sort((a, b) => b.size - a.size || a.id.localeCompare(b.id))
  for (const s of ordered) {
    let start = Math.ceil(parent.start / s.size) * s.size
    while (!s.cidr) {
      const collision = occupied.find(n => start <= n.end && n.start <= start + s.size - 1)
      if (!collision) break
      start = Math.ceil((collision.end + 1) / s.size) * s.size
    }
    const allocated = s.cidr ? parseCidr(s.cidr) : start + s.size - 1 <= parent.end ? parseCidr(`${intToIpv4(start)}/${32 - Math.log2(s.size)}`) : null
    if (allocated && !s.cidr) occupied.push(allocated)
    const gateway = s.gateway || (allocated ? allocated.firstUsable : '')
    const reservedIps = [...s.reservedIps]
    const reservedSet = new Set(reservedIps)
    if (allocated) for (let address = ipv4ToInt(allocated.firstUsable); reservedIps.length < s.reservedCount && address <= ipv4ToInt(allocated.lastUsable); address++) {
      const value = intToIpv4(address)
      if (value !== gateway && !reservedSet.has(value)) { reservedIps.push(value); reservedSet.add(value) }
    }
    const capacity = allocated ? allocated.hostCount : 0
    const usableCapacity = Math.max(0, capacity - 1 - reservedIps.length)
    segments.set(s.id, { ...s, cidr: allocated?.cidr || '', gateway, reservedIps, network: allocated?.networkAddress || '', broadcast: allocated?.broadcastAddress || '', firstUsable: allocated?.firstUsable || '', lastUsable: allocated?.lastUsable || '', capacity, usableCapacity, wasted: Math.max(0, usableCapacity - s.demand), utilization: usableCapacity ? Math.round(s.demand / usableCapacity * 1000) / 10 : 100, insufficient: s.demand > usableCapacity })
  }
  const design = { parent: parent.cidr, segments: plan.segments.map(s => segments.get(s.id)), assignments: plan.assignments }
  return { ...design, issues: validatePlan(design) }
}
export function validatePlan(plan) {
  const issues = [], parent = parseCidr(plan.parent), seen = new Map(), vlans = new Set()
  const add = (code, segmentId, message, ip) => issues.push({ code, segmentId, message, ...(ip ? { ip } : {}) })
  function usable(s, address, label) {
    const n = parseCidr(s.cidr), v = ipv4ToInt(address)
    if (!n || !contains(n, address)) add('OUTSIDE_SUBNET', s.id, `${label} ${address} is outside ${s.cidr || 'unallocated subnet'}`, address)
    else if (n.prefix < 31 && (v === n.start || v === n.end)) add('NETWORK_BROADCAST_USED', s.id, `${label} uses a network/broadcast address`, address)
  }
  for (const [index, s] of plan.segments.entries()) {
    const n = parseCidr(s.cidr)
    if (n && n.prefix > 30) add('LAN_PREFIX', s.id, 'VLAN/LAN subnets require /30 or larger; /31 and /32 are not LAN allocation blocks')
    if (!n || n.start < parent.start || n.end > parent.end) add('PARENT_CAPACITY', s.id, 'Subnet cannot fit inside the parent network')
    for (const other of plan.segments.slice(0, index)) {
      const p = parseCidr(other.cidr)
      if (n && p && n.start <= p.end && p.start <= n.end) add('OVERLAP', s.id, `Overlaps ${other.name} (${other.cidr})`)
    }
    const vlanKey = `${s.site}:${s.vlan}`
    if (vlans.has(vlanKey)) add('DUPLICATE_VLAN', s.id, 'Duplicate VLAN in the same site')
    vlans.add(vlanKey)
    if (s.insufficient) add('CAPACITY', s.id, `Requires ${s.demand} hosts; capacity is ${s.usableCapacity}`)
    for (const [address, label] of [[s.gateway, 'Gateway'], ...s.reservedIps.map(v => [v, 'Reserved IP'])]) {
      if (!address) continue
      usable(s, address, label)
      if (seen.has(address)) add('RESERVED_CONFLICT', s.id, `${label} conflicts with ${seen.get(address)}`, address)
      seen.set(address, label)
    }
  }
  const assignmentIps = new Set()
  for (const a of plan.assignments) {
    const s = plan.segments.find(v => v.id === a.segmentId)
    if (!s) { add('UNKNOWN_SEGMENT', a.segmentId, 'Assignment references an unknown segment', a.ip); continue }
    usable(s, a.ip, a.kind)
    if (assignmentIps.has(a.ip)) add('DUPLICATE_IP', s.id, 'Duplicate planned IP', a.ip)
    assignmentIps.add(a.ip)
    if (seen.has(a.ip) && !(a.kind === 'reserved' && s.reservedIps.includes(a.ip))) add('RESERVED_CONFLICT', s.id, `Assignment conflicts with ${seen.get(a.ip)}`, a.ip)
  }
  for (const s of plan.segments) {
    const allocated = plan.assignments.filter(a => a.segmentId === s.id && ['device', 'server'].includes(a.kind)).length
    if (allocated > s.usableCapacity) add('CAPACITY', s.id, 'Allocated IPs exceed available capacity')
  }
  return issues
}
export function scalePlan(input, changes) {
  const before = calculatePlan(input)
  const after = calculatePlan({ ...input, segments: input.segments.map(s => ({ ...s, hosts: changes[s.id] ?? s.hosts, cidr: '', gateway: '' })) })
  return { before, after, comparison: before.segments.map(s => {
    const next = after.segments.find(v => v.id === s.id)
    return { id: s.id, name: s.name, before: s.cidr, after: next.cidr, hostsBefore: s.hosts, hostsAfter: next.hosts, oldSubnetInsufficient: next.demand > s.usableCapacity, action: !next.cidr ? 'no-capacity' : s.cidr !== next.cidr ? 'reallocate' : 'keep' }
  }) }
}
export function compareObserved(plan, observations, now = Date.now()) {
  const findings = [], fresh = observations.filter(o => now - Date.parse(o.receivedAt) <= 5 * 60_000)
  const ips = new Map()
  for (const o of fresh) {
    const rows = ips.get(o.ip) || []; rows.push(o); ips.set(o.ip, rows)
  }
  for (const [address, rows] of ips) {
    const s = plan.segments.find(v => contains(v.cidr, address))
    if (!s) continue
    const assignments = plan.assignments.filter(a => a.ip === address), active = rows.filter(r => r.reachable || r.neighborActive)
    const expected = assignments.find(a => a.kind !== 'free')
    const emit = (code, message) => findings.push({ code, ip: address, segmentId: s.id, message })
    if (active.length && (!expected || expected.kind === 'free') && address !== s.gateway && !s.reservedIps.includes(address)) emit('UNEXPECTED_DEVICE', 'Free/unplanned IP has an observed host')
    if (!active.length && rows.some(r => r.probed !== false) && expected && ['device', 'server'].includes(expected.kind)) emit('MISSING_UNREACHABLE', 'No ICMP response or active neighbor; host may block ICMP')
    if (active.length && (s.reservedIps.includes(address) || expected?.kind === 'reserved') && (!expected?.mac || active.some(o => o.mac && normalizeMac(o.mac) !== normalizeMac(expected.mac)))) emit('RESERVED_CONFLICT', 'Reserved IP is in use by an unknown/different device')
    if (expected?.mac && active.some(o => o.mac && normalizeMac(o.mac) !== normalizeMac(expected.mac))) emit('MAC_MISMATCH', 'Observed MAC differs from the plan')
    const macs = new Set(active.filter(o => o.mac).map(o => normalizeMac(o.mac)))
    if (macs.size > 1) emit('DUPLICATE_OBSERVED_IP', 'Multiple MAC addresses observed for one IP')
  }
  const utilization = plan.segments.map(s => {
    const count = [...ips].filter(([address, rows]) => contains(s.cidr, address) && rows.some(r => r.reachable || r.neighborActive)).length
    const percent = s.capacity ? Math.round(count / s.capacity * 1000) / 10 : 0
    if (percent >= 80) findings.push({ code: 'CAPACITY_RISK', segmentId: s.id, message: `Observed usage ${percent}% of usable addresses` })
    return { segmentId: s.id, count, percent }
  })
  return { findings, utilization, freshCount: fresh.length, staleCount: observations.length - fresh.length }
}
