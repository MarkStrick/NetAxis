import express from 'express'
import { z } from 'zod'
import { nanoid, customAlphabet } from 'nanoid'
import { configureSecurity, browserToken, cookies, hash, setCookie, sessionLifetime } from '../lib/security.js'
import { parseOrThrow, roomCreateSchema, roomJoinSchema, roomPatchSchema, nodeSchema, edgeSchema } from '../lib/validation.js'
import { parseWorkspace } from '../lib/workspace-schema.js'
import { planSchema, calculatePlan, scalePlan } from '../lib/planning.js'
import { ROOM_LIFETIME_MS, roomExpired } from '../../shared/room-lifetime.js'
import { presetProjects, instantiateTemplate } from '../../shared/templates.js'
import { registerCloudProbes } from './probes.js'
import { changeRoomSimulation } from '../lib/room-simulation.js'
import { roomPlayback } from '../../shared/room-simulation.js'
import { registerCaptcha } from '../lib/captcha.js'
import { CHAT_LIMIT, chatInput, chatCursor, chatRate, newMessage, memberStatus } from '../lib/chat.js'

export function fail(statusCode, message, code = 'VALIDATION_ERROR', latest) {
  throw Object.assign(new Error(message), { statusCode, code, ...(latest ? { latest } : {}) })
}
const now = () => new Date().toISOString()
const joinCode = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 10)
const topology = s => ({ room: s.room, nodes: s.nodes, edges: s.edges, template: s.template, simulation: roomPlayback(s.simulation, s.room.revision) })
const changed = s => { s.room.revision++; s.room.updatedAt = now() }
const session = (s, token) => s?.members[hash(token)]?.expiresAt > Date.now() ? s.members[hash(token)].participant : null
const active = s => { if (roomExpired(s.room)) fail(410, 'ห้องหมดอายุแล้ว (ห้องมีอายุ 24 ชั่วโมง)', 'ROOM_EXPIRED') }
const revision = (s, value) => { if (!Number.isInteger(value) || s.room.revision !== value) fail(409, 'Your topology is out of date. Reload the latest revision before trying again.', 'REVISION_CONFLICT', topology(s)) }
const messagesFor = (s, after = 0) => ({ messages: (s.messages || []).filter(message => message.id > after), cursor: s.chatSequence || 0 })
const reply = (s, member, token, key) => ({ room: s.room, participant: member, sessionId: token, topology: topology(s), chat: messagesFor(s), ...(key ? { recoveryKey: key } : {}) })

function membership(s, displayName, role, token) {
  const current = session(s, token), timestamp = now()
  // Bound credentials stored per temporary room and discard expired memberships.
  for (const [key, value] of Object.entries(s.members)) if (value.expiresAt <= Date.now()) delete s.members[key]
  if (!current && Object.keys(s.members).length >= 100) fail(400, 'Maximum 100 participants per room')
  const participant = { id: current?.id || `user_${nanoid(10)}`, displayName, role: current?.role === 'owner' ? 'owner' : role, roomId: s.room.id, connectedAt: current?.connectedAt || timestamp, connected: false }
  s.members[hash(token)] = { ...s.members[hash(token)], participant, expiresAt: Date.now() + sessionLifetime }
  return participant
}
function fromArchive(archive) {
  const ids = new Map(archive.nodes.map(n => [n.id, `node_${nanoid(12)}`])), edges = new Map(archive.edges.map(e => [e.id, `edge_${nanoid(12)}`]))
  return { nodes: archive.nodes.map(n => ({ ...n, id: ids.get(n.id) })), edges: archive.edges.map(e => ({ ...e, id: edges.get(e.id), sourceNodeId: ids.get(e.sourceNodeId), targetNodeId: ids.get(e.targetNodeId) })),
    plan: archive.plan, template: archive.template ? { ...archive.template, scenarios: archive.template.scenarios.map(s => ({ ...s, source: ids.get(s.source) || s.source, target: ids.get(s.target) || s.target, disabledEdges: s.disabledEdges.map(id => edges.get(id) || id), enabledEdges: s.enabledEdges.map(id => edges.get(id) || id) })) } : null }
}
function newState(input, data = {}) {
  const time = now(), recoveryKey = nanoid(40)
  const s = { room: { id: `room_${nanoid(12)}`, name: input.name, description: input.description, accessMode: input.accessMode, joinCode: joinCode(), revision: data.nodes ? 1 : 0, createdAt: time, updatedAt: time, expiresAt: new Date(Date.parse(time) + ROOM_LIFETIME_MS).toISOString() },
    nodes: data.nodes || [], edges: data.edges || [], template: data.template || null,
    plan: data.plan ? { input: data.plan, revision: 1, updatedAt: time } : null,
    members: {}, probes: [], jobs: [], ownerKeyHash: hash(recoveryKey) }
  return { s, recoveryKey }
}

export function createCloudApp(store) {
  const app = express()
  if (process.env.VERCEL === '1') app.set('trust proxy', 1)
  configureSecurity(app)
  app.use('/api/rooms/restore', express.json({ limit: '4mb' }))
  app.use(express.json({ limit: '1mb' }))
  registerCaptcha(app, {
    async visitorValid(tokenHash, time) {
      await store.init()
      return Boolean((await store.driver.query('SELECT 1 FROM netaxis_cloud_visitors WHERE token_hash=$1 AND expires_at>$2', [tokenHash, time])).rows.length)
    },
    async putVisitor(tokenHash, expiresAt) {
      await store.init()
      await store.driver.query('DELETE FROM netaxis_cloud_visitors WHERE expires_at <= $1', [Date.now()])
      await store.driver.query('INSERT INTO netaxis_cloud_visitors VALUES ($1,$2)', [tokenHash, expiresAt])
    },
    async put({ id, answerHash, bindingHash, expiresAt }) {
      await store.init()
      await store.driver.query('DELETE FROM netaxis_cloud_captcha WHERE expires_at <= $1', [Date.now()])
      await store.driver.query('INSERT INTO netaxis_cloud_captcha VALUES ($1,$2,$3,$4)', [id, answerHash, bindingHash, expiresAt])
    },
    async take(id, bindingHash) {
      await store.init()
      const result = await store.driver.query('DELETE FROM netaxis_cloud_captcha WHERE id=$1 AND binding_hash=$2 RETURNING answer_hash, expires_at', [id, bindingHash])
      const row = result.rows[0]
      return row && { answerHash: row.answer_hash, expiresAt: Number(row.expires_at) }
    },
  })
  const route = fn => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  const sendSession = (res, value) => { setCookie(res, 'netaxis-session', value.sessionId); setCookie(res, 'netaxis-room', value.room.id); return value }
  async function roomAction(req, write, fn, role = 'member') {
    return store.transaction(async client => {
      const s = await store.find('id', req.params.roomId, client, true)
      if (!s) fail(404, 'Room not found', 'NOT_FOUND')
      const member = session(s, browserToken(req))
      if (!member) fail(401, 'Join a room before making this request', 'UNAUTHORIZED')
      active(s)
      if (role === 'owner' && member.role !== 'owner' || role === 'editor' && !['editor', 'owner'].includes(member.role)) fail(403, 'Your room role cannot perform this action', 'PERMISSION_DENIED')
      const result = await fn(s, member, client)
      if (write) await store.save(s, client)
      return result
    })
  }
  app.get('/api/health', route(async (_req, res) => { await store.init(); await store.driver.query('SELECT 1'); res.json({ ok: true, service: 'netaxis-topology', deployment: 'vercel', storage: 'postgres', sync: 'polling', time: now() }) }))
  app.get('/api/rooms', route(async (req, res) => res.json({ rooms: browserToken(req) ? await store.list(hash(browserToken(req))) : [] })))
  app.get('/api/session', route(async (req, res) => {
    const roomId = cookies(req)['netaxis-room']
    if (!roomId) fail(401, 'Session expired; please join your room again.', 'SESSION_EXPIRED')
    req.params.roomId = roomId
    res.json(await roomAction(req, false, (s, m) => reply(s, m, browserToken(req))))
  }))
  app.post('/api/session/leave', route(async (req, res) => {
    const roomId = cookies(req)['netaxis-room'], token = browserToken(req), tabId = req.body?.tabId
    if (roomId && token && typeof tabId === 'string' && tabId.length <= 80) {
      const s = await store.find('id', roomId), m = session(s, token)
      if (m) await store.driver.query('DELETE FROM netaxis_cloud_presence WHERE room_id=$1 AND participant_id=$2 AND tab_id=$3', [roomId, m.id, tabId])
    }
    setCookie(res, 'netaxis-room', '', 0); res.status(204).end()
  }))
  app.post('/api/rooms/:roomId/resume', route(async (req, res) => res.json(sendSession(res, await roomAction(req, false, (s, m) => reply(s, m, browserToken(req)))))))
  async function create(req, res, restored) {
    const archive = restored ? parseWorkspace(req.body?.workspace) : null
    const input = parseOrThrow(roomCreateSchema, restored ? { ...archive.room, displayName: req.body?.displayName } : req.body)
    const preset = input.templateId ? presetProjects.find(p => p.id === input.templateId) : null
    if (input.templateId && !preset) fail(400, 'Template not found', 'UNKNOWN_TEMPLATE')
    let data = archive ? fromArchive(archive) : {}
    if (preset) { const template = instantiateTemplate(preset, nanoid(12)); data = { nodes: template.nodes, edges: template.edges, plan: planSchema.parse(template.plan), template: template.info } }
    const { s, recoveryKey } = newState(input, data), token = browserToken(req) || nanoid(32)
    const m = membership(s, input.displayName, 'owner', token)
    await store.transaction(client => store.save(s, client, true))
    res.status(201).json(sendSession(res, reply(s, m, token, recoveryKey)))
  }
  app.post('/api/rooms', route((req, res) => create(req, res, false)))
  app.post('/api/rooms/restore', route((req, res) => create(req, res, true)))
  app.post('/api/rooms/join', route(async (req, res) => {
    const input = parseOrThrow(roomJoinSchema, req.body), token = browserToken(req) || nanoid(32)
    const value = await store.transaction(async client => {
      const s = await store.find('code', input.joinCode.toUpperCase(), client, true)
      if (!s) fail(404, 'Room code not found', 'NOT_FOUND')
      active(s)
      if (input.recoveryKey && hash(input.recoveryKey) !== s.ownerKeyHash) fail(403, 'รหัสกู้สิทธิ์เจ้าของห้องไม่ถูกต้อง', 'INVALID_RECOVERY_KEY')
      const role = input.recoveryKey ? 'owner' : s.room.accessMode === 'viewer' ? 'viewer' : input.role
      const member = membership(s, input.displayName, role, token)
      await store.save(s, client); return reply(s, member, token)
    })
    res.json(sendSession(res, value))
  }))
  app.get('/api/rooms/:roomId', route(async (req, res) => res.json(await roomAction(req, false, topology))))
  app.get('/api/rooms/:roomId/export', route(async (req, res) => res.json(await roomAction(req, false, s => ({ ...parseWorkspace({ format: 'netaxis-workspace', version: 1, room: s.room, nodes: s.nodes, edges: s.edges, plan: s.plan?.input || null, template: s.template }), exportedAt: now() })))))
  app.post('/api/rooms/:roomId/recovery', route(async (req, res) => res.json(await roomAction(req, true, s => { const recoveryKey = nanoid(40); s.ownerKeyHash = hash(recoveryKey); return { recoveryKey } }, 'owner'))))
  app.patch('/api/rooms/:roomId', route(async (req, res) => res.json(await roomAction(req, true, s => {
    const changes = parseOrThrow(roomPatchSchema, req.body)
    Object.assign(s.room, changes, { updatedAt: now() })
    if (changes.accessMode === 'viewer') for (const member of Object.values(s.members)) if (member.participant.role === 'editor') member.participant.role = 'viewer'
    return { room: s.room }
  }, 'owner'))))
  app.delete('/api/rooms/:roomId', route(async (req, res) => { await roomAction(req, false, (s, _m, client) => client.query('DELETE FROM netaxis_cloud_rooms WHERE id=$1', [s.room.id]), 'owner'); res.status(204).end() }))
  app.get('/api/rooms/:roomId/presence', route(async (req, res) => res.json(await roomAction(req, false, async (s, _m, client) => ({ participants: await store.presence(s, client) })))))
  app.patch('/api/rooms/:roomId/member-status', route(async (req, res) => res.json(await roomAction(req, true, async (s, m, client) => {
    const status = memberStatus(req.body)
    s.members[hash(browserToken(req))].status = status
    return { status, participants: await store.presence(s, client) }
  }))))
  app.get('/api/rooms/:roomId/messages', route(async (req, res) => res.json(await roomAction(req, false, s => messagesFor(s, chatCursor(req.query.after))))))
  app.post('/api/rooms/:roomId/messages', route(async (req, res) => {
    const input = chatInput(req.body)
    res.status(201).json(await roomAction(req, true, (s, m) => {
      s.messages ||= []
      const existing = s.messages.find(message => message.participantId === m.id && message.clientId === input.clientId)
      if (existing) return { message: existing }
      const member = s.members[hash(browserToken(req))]
      member.chatLimit = chatRate(member.chatLimit)
      s.chatSequence = (s.chatSequence || 0) + 1
      const message = newMessage(input, m, s.chatSequence)
      s.messages = [...s.messages, message].slice(-CHAT_LIMIT)
      return { message }
    }))
  }))
  app.post('/api/rooms/:roomId/sync', route(async (req, res) => {
    const input = parseOrThrow(z.object({ revision: z.number().int().min(0), tabId: z.string().min(1).max(80).regex(/^[\w-]+$/), chatCursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0) }), req.body)
    res.json(await roomAction(req, false, async (s, m, client) => {
      await client.query('DELETE FROM netaxis_cloud_presence WHERE room_id=$1 AND seen_at<$2', [s.room.id, Date.now() - 45000])
      const count = await client.query('SELECT count(*)::int AS n FROM netaxis_cloud_presence WHERE room_id=$1 AND participant_id=$2 AND tab_id<>$3', [s.room.id, m.id, input.tabId])
      if (count.rows[0].n >= 8) fail(429, 'Too many active tabs for this room', 'RATE_LIMIT')
      await client.query('INSERT INTO netaxis_cloud_presence VALUES ($1,$2,$3,$4) ON CONFLICT(room_id,participant_id,tab_id) DO UPDATE SET seen_at=EXCLUDED.seen_at', [s.room.id, m.id, input.tabId, Date.now()])
      return { room: s.room, participant: m, participants: await store.presence(s, client), chat: messagesFor(s, input.chatCursor), simulation: roomPlayback(s.simulation, s.room.revision), ...(input.revision !== s.room.revision ? { topology: topology(s) } : {}) }
    }))
  }))
  app.post('/api/rooms/:roomId/simulation', route(async (req, res) => res.json(await roomAction(req, true, (s, m) => {
    s.simulation = changeRoomSimulation(topology(s), s.simulation, m, req.body)
    return { simulation: roomPlayback(s.simulation, s.room.revision) }
  }, 'editor'))))
  app.post('/api/rooms/:roomId/topology/import', route(async (req, res) => res.json(await roomAction(req, true, s => {
    revision(s, req.get('x-topology-revision') === undefined ? NaN : Number(req.get('x-topology-revision')))
    const value = parseWorkspace({ ...req.body, format: 'netaxis-workspace', version: 1, room: s.room, plan: null, template: null })
    s.nodes = value.nodes; s.edges = value.edges; changed(s); return topology(s)
  }, 'editor'))))
  for (const entity of ['node', 'edge']) for (const operation of ['create', 'update', 'delete']) {
    const method = { create: 'post', update: 'patch', delete: 'delete' }[operation]
    app[method](`/api/rooms/:roomId/${entity}s${operation === 'create' ? '' : '/:id'}`, route(async (req, res) => {
      const result = await roomAction(req, true, (s, member) => {
        revision(s, req.get('x-topology-revision') === undefined ? NaN : Number(req.get('x-topology-revision')))
        const list = s[entity + 's'], existing = list.find(n => n.id === req.params.id)
        if (operation !== 'create' && !existing) fail(404, `${entity} not found`, 'NOT_FOUND')
        const id = operation === 'create' ? req.body?.id || `${entity}_${nanoid(12)}` : req.params.id
        let result
        if (operation === 'delete') {
          result = { id }
          s[entity + 's'] = list.filter(n => n.id !== id)
          if (entity === 'node') { result.edgeIds = s.edges.filter(e => e.sourceNodeId === id || e.targetNodeId === id).map(e => e.id); s.edges = s.edges.filter(e => !result.edgeIds.includes(e.id)) }
        } else {
          if (operation === 'create' && list.length >= (entity === 'node' ? 500 : 1000)) fail(400, 'Room capacity reached (500 devices / 1000 links)', 'ROOM_CAPACITY')
          if (operation === 'create' && list.some(n => n.id === id)) fail(409, 'An entity with this ID already exists', 'ENTITY_CONFLICT')
          const parsed = parseOrThrow(entity === 'node' ? nodeSchema : edgeSchema, { ...req.body, id })
          if (entity === 'node' && parsed.data.ipv4 && s.nodes.some(n => n.id !== id && n.data.ipv4 === parsed.data.ipv4)) fail(400, 'IPv4 address is already used', 'DUPLICATE_IPV4')
          if (entity === 'edge' && (!s.nodes.some(n => n.id === parsed.sourceNodeId) || !s.nodes.some(n => n.id === parsed.targetNodeId))) fail(400, 'Edge endpoints must exist in this room', 'INVALID_EDGE_ENDPOINT')
          result = { ...parsed, roomId: s.room.id, createdAt: existing?.createdAt || now(), updatedAt: now(), updatedBy: member.id }
          if (operation === 'create') list.push(result); else list[list.indexOf(existing)] = result
        }
        changed(s); return { room: s.room, [entity]: result, actorId: member.id }
      }, 'editor')
      res.status(operation === 'create' ? 201 : 200).json(result)
    }))
  }
  const root = '/api/rooms/:roomId/planning'
  const loaded = s => s.plan ? { ...s.plan, design: calculatePlan(s.plan.input) } : null
  app.get(root, route(async (req, res) => res.json(await roomAction(req, false, s => ({ plan: loaded(s) })))))
  app.put(root, route(async (req, res) => res.json(await roomAction(req, true, s => {
    const value = parseOrThrow(z.object({ input: planSchema, revision: z.number().int().nonnegative() }), req.body)
    if ((s.plan?.revision || 0) !== value.revision) fail(409, 'Plan changed in another tab. Reload before saving.', 'REVISION_CONFLICT')
    s.plan = { input: value.input, revision: value.revision + 1, updatedAt: now() }; return { plan: loaded(s) }
  }, 'editor'))))
  app.post(root + '/calculate', route(async (req, res) => res.json(await roomAction(req, false, () => ({ design: calculatePlan(parseOrThrow(planSchema, req.body)) })))) )
  app.post(root + '/scale', route(async (req, res) => res.json(await roomAction(req, false, () => {
    const value = parseOrThrow(z.object({ input: planSchema, changes: z.record(z.number().int().min(1).max(10_000_000)) }), req.body)
    if (Object.keys(value.changes).some(id => !value.input.segments.some(s => s.id === id))) fail(400, 'Unknown segment in scale changes')
    return scalePlan(value.input, value.changes)
  }))))
  registerCloudProbes(app, { store, roomAction, route, loaded, fail, active })
  app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'API endpoint not found' }))
  app.use((error, _req, res, _next) => {
    const status = error.statusCode || error.status || (error.code === '23505' ? 409 : 500)
    if (status >= 500) console.error('Cloud API error:', error.code || error.name)
    res.status(status).json({ error: error.code || 'SERVER_ERROR', message: status >= 500 ? 'Unable to reach database. Check the Vercel database connection and try again.' : error.message, ...(error.latest ? { latest: error.latest } : {}) })
  })
  return app
}
