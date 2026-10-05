import { z } from 'zod'
import { nanoid } from 'nanoid'
import { db } from './db.js'
import { hash } from './lib/security.js'
import { parseOrThrow } from './lib/validation.js'
import { planSchema, calculatePlan, scalePlan, parseCidr, contains, privateCidr, compareObserved } from './lib/planning.js'
import { intToIpv4 } from './lib/subnet.js'

db.exec(`
  CREATE TABLE IF NOT EXISTS ip_plans (
    room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, input_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS probes (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL, segment_id TEXT NOT NULL, network TEXT NOT NULL,
    token_hash TEXT NOT NULL, last_seen TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS probe_jobs (
    id TEXT PRIMARY KEY, probe_id TEXT NOT NULL REFERENCES probes(id) ON DELETE CASCADE,
    plan_revision INTEGER NOT NULL, kind TEXT NOT NULL, targets_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL, leased_at INTEGER,
    lease TEXT, attempts INTEGER NOT NULL DEFAULT 0, received_at TEXT, result_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_probe ON probe_jobs(probe_id, created_at);
`)
const now = () => new Date().toISOString()
const fail = (status, message) => { const error = new Error(message); error.statusCode = status; throw error }
const loaded = roomId => { const row = db.prepare('SELECT * FROM ip_plans WHERE room_id = ?').get(roomId); return row ? { revision: row.revision, updatedAt: row.updated_at, input: JSON.parse(row.input_json), design: calculatePlan(JSON.parse(row.input_json)) } : null }
const ipv4 = z.string().refine(v => Boolean(parseCidr(`${v}/32`)), 'Invalid IPv4')
const observations = z.array(z.object({ ip: ipv4, reachable: z.boolean(), probed: z.boolean().default(true), neighborActive: z.boolean().default(false), mac: z.string().regex(/^([a-fA-F0-9]{2}[:-]){5}[a-fA-F0-9]{2}$/).optional().or(z.literal('')), latencyMs: z.number().nonnegative().max(120000).nullable().optional() })).max(256)
const reportSchema = z.object({ lease: z.string().min(10).max(80), observations: observations.default([]), output: z.string().max(32_000).default(''), error: z.string().max(2000).default('') })
export function registerPlanningApi(app, { requireSession, requireRoomAccess, requireEditor, sendError }) {
  const member = [requireSession, requireRoomAccess]
  const write = [...member, requireEditor]
  const wrap = handler => (req, res) => { try { handler(req, res) } catch (error) { sendError(res, error) } }
  const root = '/api/rooms/:roomId/planning'
  app.get(root, ...member, wrap((req, res) => res.json({ plan: loaded(req.params.roomId) })))
  app.post(root + '/calculate', ...member, wrap((req, res) => res.json({ design: calculatePlan(parseOrThrow(planSchema, req.body)) })))
  app.post(root + '/scale', ...member, wrap((req, res) => {
    const { input, changes } = parseOrThrow(z.object({ input: planSchema, changes: z.record(z.number().int().min(1).max(10_000_000)) }), req.body)
    if (Object.keys(changes).some(id => !input.segments.some(s => s.id === id))) fail(400, 'Unknown segment in scale changes')
    res.json(scalePlan(input, changes))
  }))
  app.put(root, ...write, wrap((req, res) => {
    const { input, revision } = parseOrThrow(z.object({ input: planSchema, revision: z.number().int().nonnegative() }), req.body)
    const design = calculatePlan(input)
    db.transaction(() => {
      const current = loaded(req.params.roomId)
      if ((current?.revision || 0) !== revision) fail(409, 'Plan changed in another tab. Reload before saving.')
      db.prepare(`INSERT INTO ip_plans VALUES (?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET revision=excluded.revision, input_json=excluded.input_json, updated_at=excluded.updated_at`).run(req.params.roomId, revision + 1, JSON.stringify(input), now())
    })()
    res.json({ plan: loaded(req.params.roomId), design })
  }))
  app.get(root + '/probes', ...member, wrap((req, res) => {
    const probes = db.prepare('SELECT id, name, segment_id AS segmentId, network, last_seen AS lastSeen FROM probes WHERE room_id = ?').all(req.params.roomId)
    res.json({ probes: probes.map(p => ({ ...p, online: Boolean(p.lastSeen && Date.now() - Date.parse(p.lastSeen) < 180_000) })) })
  }))
  app.post(root + '/probes', ...write, wrap((req, res) => {
    if (req.session.role !== 'owner') fail(403, 'Only owners can enroll probes')
    const input = parseOrThrow(z.object({ name: z.string().trim().min(1).max(120), segmentId: z.string().max(80) }), req.body)
    const plan = loaded(req.params.roomId), segment = plan?.design.segments.find(s => s.id === input.segmentId)
    if (!segment || plan.design.issues.length || !privateCidr(segment.cidr)) fail(400, 'Save a valid plan with an RFC1918 subnet before enrolling a probe')
    if (db.prepare('SELECT COUNT(*) AS count FROM probes WHERE room_id = ?').get(req.params.roomId).count >= 100) fail(400, 'Maximum 100 probes per room')
    const token = nanoid(48), id = nanoid(20)
    db.prepare('INSERT INTO probes (id,room_id,name,segment_id,network,token_hash,created_at) VALUES (?,?,?,?,?,?,?)').run(id, req.params.roomId, input.name, input.segmentId, segment.cidr, hash(token), now())
    res.status(201).json({ id, token, network: segment.cidr, segmentId: segment.id })
  }))
  app.delete(root + '/probes/:probeId', ...write, wrap((req, res) => {
    if (req.session.role !== 'owner') fail(403, 'Only owners can revoke probes')
    db.prepare('DELETE FROM probes WHERE id = ? AND room_id = ?').run(req.params.probeId, req.params.roomId)
    res.status(204).end()
  }))
  app.post(root + '/probes/:probeId/jobs', ...write, wrap((req, res) => {
    const { kind, target, offset } = parseOrThrow(z.object({ kind: z.enum(['scan', 'host', 'neighbor', 'traceroute', 'netstat']), target: ipv4.optional(), offset: z.number().int().min(0).max(16_777_216).default(0) }), req.body)
    const probe = db.prepare('SELECT * FROM probes WHERE id = ? AND room_id = ?').get(req.params.probeId, req.params.roomId), plan = loaded(req.params.roomId)
    if (!probe || !plan) fail(404, 'Probe or saved plan not found')
    const segment = plan.design.segments.find(s => s.id === probe.segment_id)
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
    const pending = db.prepare("SELECT COUNT(*) AS count FROM probe_jobs WHERE probe_id = ? AND state IN ('queued','running')").get(probe.id).count
    if (pending >= 8) fail(429, 'Probe already has 8 pending jobs')
    const id = nanoid(20)
    db.prepare('INSERT INTO probe_jobs (id,probe_id,plan_revision,kind,targets_json,created_at) VALUES (?,?,?,?,?,?)').run(id, probe.id, plan.revision, kind, JSON.stringify(targets), now())
    res.status(201).json({ id, state: 'queued', targets, totalUsable: net.hostCount, offset, coverage: targets.length })
  }))
  app.get(root + '/verification', ...member, wrap((req, res) => {
    const plan = loaded(req.params.roomId)
    const jobs = db.prepare(`SELECT j.*, p.name AS probe_name, p.segment_id FROM probe_jobs j JOIN probes p ON p.id=j.probe_id WHERE p.room_id=? ORDER BY j.created_at DESC LIMIT 100`).all(req.params.roomId)
    const latest = new Map()
    for (const j of jobs.filter(j => j.state === 'completed' && j.plan_revision === plan?.revision).sort((a, b) => b.received_at.localeCompare(a.received_at))) {
      for (const o of JSON.parse(j.result_json).observations) {
        const key = j.probe_id + ':' + o.ip
        if (!latest.has(key)) latest.set(key, { ...o, probeId: j.probe_id, probeName: j.probe_name, receivedAt: j.received_at })
      }
    }
    const observations = [...latest.values()]
    res.json({ observations, comparison: plan ? compareObserved(plan.design, observations) : { findings: [], utilization: [], freshCount: 0, staleCount: 0 }, jobs: jobs.map(j => ({ id: j.id, probeId: j.probe_id, probeName: j.probe_name, kind: j.kind, state: j.state, createdAt: j.created_at, receivedAt: j.received_at, planRevision: j.plan_revision, coverage: JSON.parse(j.targets_json).length, result: j.result_json ? JSON.parse(j.result_json) : null })) })
  }))
  function agent(req, res, next) {
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    const probe = typeof token === 'string' && token.length <= 256 ? db.prepare('SELECT * FROM probes WHERE id = ? AND token_hash = ?').get(req.params.probeId, hash(token)) : null
    if (!probe) return res.status(401).json({ error: 'INVALID_PROBE', message: 'Probe token is invalid or revoked' })
    req.probe = probe; db.prepare('UPDATE probes SET last_seen = ? WHERE id = ?').run(now(), probe.id); next()
  }
  app.get('/api/probes/:probeId/jobs', agent, wrap((req, res) => {
    const job = db.transaction(() => {
      db.prepare("UPDATE probe_jobs SET state='failed', result_json=? WHERE probe_id=? AND ((state='queued' AND created_at < ?) OR (state='running' AND leased_at < ? AND attempts >= 2))").run(JSON.stringify({ observations: [], output: '', error: 'Job expired or agent did not report' }), req.probe.id, new Date(Date.now() - 600_000).toISOString(), Date.now() - 180_000)
      db.prepare("UPDATE probe_jobs SET state='queued' WHERE probe_id=? AND state='running' AND leased_at < ? AND attempts < 2").run(req.probe.id, Date.now() - 180_000)
      const row = db.prepare("SELECT * FROM probe_jobs WHERE probe_id=? AND state='queued' ORDER BY created_at LIMIT 1").get(req.probe.id)
      if (!row) return null
      const current = loaded(req.probe.room_id), segment = current?.design.segments.find(s => s.id === req.probe.segment_id)
      if (!current || current.revision !== row.plan_revision || segment?.cidr !== req.probe.network || current.design.issues.length) {
        db.prepare("UPDATE probe_jobs SET state='failed', result_json=? WHERE id=?").run(JSON.stringify({ error: 'Plan changed; queue a new job', observations: [], output: '' }), row.id); return null
      }
      const lease = nanoid(24)
      db.prepare("UPDATE probe_jobs SET state='running', lease=?, leased_at=?, attempts=attempts+1 WHERE id=?").run(lease, Date.now(), row.id)
      return { id: row.id, kind: row.kind, network: req.probe.network, targets: JSON.parse(row.targets_json), lease }
    })()
    res.json({ job })
  }))
  app.post('/api/probes/:probeId/jobs/:jobId/result', agent, wrap((req, res) => {
    const result = parseOrThrow(reportSchema, req.body)
    const job = db.prepare('SELECT * FROM probe_jobs WHERE id=? AND probe_id=?').get(req.params.jobId, req.probe.id)
    if (!job || job.lease !== result.lease || !['running', 'completed', 'failed'].includes(job.state)) fail(409, 'Job lease is invalid')
    if (job.state !== 'running') return res.json({ ok: true })
    const targets = JSON.parse(job.targets_json)
    if (new Set(result.observations.map(o => o.ip)).size !== result.observations.length || result.observations.some(o => !targets.includes(o.ip))) fail(400, 'Observations must be unique and belong to the job targets')
    if (!result.error && ['scan', 'host', 'neighbor'].includes(job.kind) && result.observations.length !== targets.length) fail(400, 'Report must include every requested target')
    result.observations = result.observations.map(o => ({ ...o, probed: ['scan', 'host'].includes(job.kind) }))
    db.prepare('UPDATE probe_jobs SET state=?, received_at=?, result_json=? WHERE id=?').run(result.error ? 'failed' : 'completed', now(), JSON.stringify(result), job.id)
    // Retain a bounded history per probe. Never delete pending work.
    db.prepare("DELETE FROM probe_jobs WHERE probe_id=? AND state IN ('completed','failed') AND id NOT IN (SELECT id FROM probe_jobs WHERE probe_id=? AND state IN ('completed','failed') ORDER BY created_at DESC LIMIT 100)").run(req.probe.id, req.probe.id)
    res.json({ ok: true })
  }))
}
