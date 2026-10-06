import { z } from 'zod'
import { nanoid } from 'nanoid'
import { hash } from '../lib/security.js'
import { parseOrThrow } from '../lib/validation.js'
import { parseCidr, contains, privateCidr, compareObserved } from '../lib/planning.js'
import { intToIpv4 } from '../lib/subnet.js'

const now = () => new Date().toISOString()
const ipv4 = z.string().refine(v => Boolean(parseCidr(`${v}/32`)), 'Invalid IPv4')
const reportSchema = z.object({ lease: z.string().min(10).max(80), observations: z.array(z.object({ ip: ipv4, reachable: z.boolean(), probed: z.boolean().default(true), neighborActive: z.boolean().default(false), mac: z.string().regex(/^([a-fA-F0-9]{2}[:-]){5}[a-fA-F0-9]{2}$/).optional().or(z.literal('')), latencyMs: z.number().nonnegative().max(120000).nullable().optional() })).max(256).default([]), output: z.string().max(32000).default(''), error: z.string().max(2000).default('') })
export function registerCloudProbes(app, { store, roomAction, route, loaded, fail, active }) {
  const root = '/api/rooms/:roomId/planning'
  app.get(root + '/probes', route(async (req, res) => res.json(await roomAction(req, false, s => ({ probes: s.probes.map(({ tokenHash, ...p }) => ({ ...p, online: Boolean(p.lastSeen && Date.now() - Date.parse(p.lastSeen) < 180000) })) })))))
  app.post(root + '/probes', route(async (req, res) => res.status(201).json(await roomAction(req, true, s => {
    const input = parseOrThrow(z.object({ name: z.string().trim().min(1).max(120), segmentId: z.string().max(80) }), req.body)
    const plan = loaded(s), segment = plan?.design.segments.find(v => v.id === input.segmentId)
    if (!segment || plan.design.issues.length || !privateCidr(segment.cidr)) fail(400, 'Save a valid plan with an RFC1918 subnet before enrolling a probe')
    if (s.probes.length >= 100) fail(400, 'Maximum 100 probes per room')
    const token = nanoid(48), id = nanoid(20)
    s.probes.push({ id, name: input.name, segmentId: segment.id, network: segment.cidr, tokenHash: hash(token), createdAt: now(), lastSeen: null })
    return { id, token, network: segment.cidr, segmentId: segment.id }
  }, 'owner'))))
  app.delete(root + '/probes/:probeId', route(async (req, res) => {
    await roomAction(req, true, s => { s.probes = s.probes.filter(p => p.id !== req.params.probeId); s.jobs = s.jobs.filter(j => j.probeId !== req.params.probeId) }, 'owner')
    res.status(204).end()
  }))
  app.post(root + '/probes/:probeId/jobs', route(async (req, res) => res.status(201).json(await roomAction(req, true, s => {
    const { kind, target, offset } = parseOrThrow(z.object({ kind: z.enum(['scan', 'host', 'neighbor', 'traceroute', 'netstat']), target: ipv4.optional(), offset: z.number().int().min(0).max(16777216).default(0) }), req.body)
    const probe = s.probes.find(p => p.id === req.params.probeId), plan = loaded(s)
    if (!probe || !plan) fail(404, 'Probe or saved plan not found')
    const segment = plan.design.segments.find(v => v.id === probe.segmentId)
    if (plan.design.issues.length || segment?.cidr !== probe.network) fail(409, 'Design changed or has validation errors; re-enroll the probe for its current subnet')
    const net = parseCidr(probe.network), targets = []
    if (['host', 'traceroute'].includes(kind)) {
      if (!target || !contains(net, target) || target === net.networkAddress || target === net.broadcastAddress) fail(400, 'Target must be a usable IP in the probe subnet')
      targets.push(target)
    } else if (kind !== 'netstat') {
      const first = net.start + 1 + offset, last = Math.min(first + 255, net.end - 1)
      if (first > net.end - 1) fail(400, 'Scan offset exceeds subnet capacity')
      for (let address = first; address <= last; address++) targets.push(intToIpv4(address))
    }
    if (s.jobs.filter(j => j.probeId === probe.id && ['queued', 'running'].includes(j.state)).length >= 8) fail(429, 'Probe already has 8 pending jobs')
    const id = nanoid(20)
    s.jobs.push({ id, probeId: probe.id, planRevision: plan.revision, kind, targets, state: 'queued', createdAt: now(), attempts: 0, lease: null, leasedAt: null, receivedAt: null, result: null })
    return { id, state: 'queued', targets, totalUsable: net.hostCount, offset, coverage: targets.length }
  }, 'editor'))))
  app.get(root + '/verification', route(async (req, res) => res.json(await roomAction(req, false, s => {
    const plan = loaded(s), jobs = [...s.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100), latest = new Map()
    for (const j of jobs.filter(j => j.state === 'completed' && j.planRevision === plan?.revision).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))) {
      for (const o of j.result.observations) {
        const key = `${j.probeId}:${o.ip}`
        if (!latest.has(key)) latest.set(key, { ...o, probeId: j.probeId, probeName: s.probes.find(p => p.id === j.probeId)?.name, receivedAt: j.receivedAt })
      }
    }
    const observations = [...latest.values()]
    return { observations, comparison: plan ? compareObserved(plan.design, observations) : { findings: [], utilization: [], freshCount: 0, staleCount: 0 }, jobs: jobs.map(({ lease, targets, ...j }) => ({ ...j, probeName: s.probes.find(p => p.id === j.probeId)?.name, coverage: targets.length })) }
  }))))
  async function agent(req, fn) {
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    if (!token || token.length > 256) fail(401, 'Probe token is invalid or revoked', 'INVALID_PROBE')
    return store.transaction(async client => {
      const s = await store.find('probe', req.params.probeId, client, true)
      const probe = s?.probes.find(p => p.id === req.params.probeId && p.tokenHash === hash(token))
      if (!probe) fail(401, 'Probe token is invalid or revoked', 'INVALID_PROBE')
      active(s); probe.lastSeen = now()
      const value = fn(s, probe)
      await store.save(s, client); return value
    })
  }
  app.get('/api/probes/:probeId/jobs', route(async (req, res) => res.json(await agent(req, (s, probe) => {
    for (const j of s.jobs.filter(j => j.probeId === probe.id)) {
      if (j.state === 'queued' && Date.parse(j.createdAt) < Date.now() - 600000 || j.state === 'running' && j.leasedAt < Date.now() - 180000 && j.attempts >= 2) { j.state = 'failed'; j.result = { observations: [], output: '', error: 'Job expired or agent did not report' } }
      else if (j.state === 'running' && j.leasedAt < Date.now() - 180000) j.state = 'queued'
    }
    const job = s.jobs.filter(j => j.probeId === probe.id && j.state === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (!job) return { job: null }
    const plan = loaded(s), segment = plan?.design.segments.find(v => v.id === probe.segmentId)
    if (!plan || plan.revision !== job.planRevision || segment?.cidr !== probe.network || plan.design.issues.length) { job.state = 'failed'; job.result = { observations: [], output: '', error: 'Plan changed; queue a new job' }; return { job: null } }
    Object.assign(job, { state: 'running', lease: nanoid(24), leasedAt: Date.now(), attempts: job.attempts + 1 })
    return { job: { id: job.id, kind: job.kind, network: probe.network, targets: job.targets, lease: job.lease } }
  }))))
  app.post('/api/probes/:probeId/jobs/:jobId/result', route(async (req, res) => res.json(await agent(req, (s, probe) => {
    const result = parseOrThrow(reportSchema, req.body), job = s.jobs.find(j => j.id === req.params.jobId && j.probeId === probe.id)
    if (!job || job.lease !== result.lease || !['running', 'completed', 'failed'].includes(job.state)) fail(409, 'Job lease is invalid')
    if (job.state !== 'running') return { ok: true }
    if (new Set(result.observations.map(o => o.ip)).size !== result.observations.length || result.observations.some(o => !job.targets.includes(o.ip))) fail(400, 'Observations must be unique and belong to the job targets')
    if (!result.error && ['scan', 'host', 'neighbor'].includes(job.kind) && result.observations.length !== job.targets.length) fail(400, 'Report must include every requested target')
    result.observations = result.observations.map(o => ({ ...o, probed: ['scan', 'host'].includes(job.kind) }))
    Object.assign(job, { state: result.error ? 'failed' : 'completed', receivedAt: now(), result })
    const completed = s.jobs.filter(j => ['completed', 'failed'].includes(j.state)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const keep = new Set(completed.slice(0, 100).map(j => j.id))
    s.jobs = s.jobs.filter(j => !['completed', 'failed'].includes(j.state) || keep.has(j.id))
    return { ok: true }
  }))))
}
