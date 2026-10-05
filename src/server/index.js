import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import express from 'express'
import { Server as SocketServer } from 'socket.io'
import { nanoid } from 'nanoid'
import {
  createRoom, getRoomById, getRoomByJoinCode, listAccessibleRooms, getTopology, updateRoom, removeRoom,
  insertNode, updateNode, removeNode, insertEdge, updateEdge, removeEdge, bumpRevision, replaceTopology, db, issueOwnerKey, ownerKeyValid,
} from './db.js'
import {
  parseOrThrow, roomCreateSchema, roomJoinSchema, roomPatchSchema,
  nodeSchema, edgeSchema,
} from './lib/validation.js'
import { configureSecurity, cookies, browserToken, setCookie, hash, sessionLifetime, originAllowed, production } from './lib/security.js'
import { registerPlanningApi } from './planning-api.js'

const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'
const app = express()
const httpServer = http.createServer(app)
const io = new SocketServer(httpServer, {
  maxHttpBufferSize: 1_000_000,
  allowRequest: (req, callback) => callback(null, originAllowed(req.headers.origin, req)),
})

const roomParticipants = new Map()
configureSecurity(app)
app.use(express.json({ limit: '1mb' }))

function sendError(res, error) {
  const conflict = error.code?.startsWith('SQLITE_CONSTRAINT')
  const status = error.statusCode || error.status || (conflict ? 409 : 500)
  if (status >= 500) console.error(error)
  res.status(status).json({ error: conflict ? 'ENTITY_CONFLICT' : error.code || 'SERVER_ERROR', message: status >= 500 ? 'Unexpected server error' : conflict ? 'An entity with this ID already exists; reload or import with unique IDs.' : error.message })
}

function getSession(req) {
  return sessionFor(browserToken(req), req.params?.roomId || cookies(req)['netaxis-room'])
}

function sessionFor(token, roomId) {
  if (!token || !roomId) return null
  const row = db.prepare('SELECT * FROM room_access WHERE token_hash = ? AND room_id = ? AND expires_at > ?').get(hash(token), roomId, Date.now())
  return row ? { id: row.participant_id, displayName: row.display_name, role: row.role, roomId: row.room_id, connectedAt: row.connected_at, connected: Boolean(roomParticipants.get(roomId)?.get(row.participant_id)?.sockets.size) } : null
}

function requireSession(req, res, next) {
  const session = getSession(req)
  if (!session) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Join a room before making this request' })
  req.session = session
  return next()
}

function findRoomAccess(session, roomId) {
  return session && session.roomId === roomId ? session : null
}

function requireRoomAccess(req, res, next) {
  if (!findRoomAccess(req.session, req.params.roomId)) return res.status(403).json({ error: 'FORBIDDEN', message: 'You are not a member of this room' })
  req.room = getRoomById(req.params.roomId)
  if (!req.room) return res.status(404).json({ error: 'NOT_FOUND', message: 'Room not found' })
  return next()
}

function requireEditor(req, res, next) {
  if (!['owner', 'editor'].includes(req.session.role)) return res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Viewer access cannot modify topology' })
  return next()
}

function createSession({ roomId, displayName, role }, req, res) {
  const sessionId = browserToken(req) || nanoid(32)
  const existing = sessionFor(sessionId, roomId)
  if (existing?.role === 'owner') role = 'owner'
  const participant = { id: `user_${nanoid(10)}`, displayName, role, roomId, connectedAt: new Date().toISOString(), connected: false }
  if (existing) participant.id = existing.id
  db.prepare(`INSERT INTO room_access (token_hash, room_id, participant_id, display_name, role, connected_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_hash, room_id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, expires_at = excluded.expires_at`).run(hash(sessionId), roomId, participant.id, displayName, role, participant.connectedAt, Date.now() + sessionLifetime)
  setCookie(res, 'netaxis-session', sessionId)
  setCookie(res, 'netaxis-room', roomId)
  return { sessionId, participant }
}

function participantsFor(roomId) {
  return [...(roomParticipants.get(roomId)?.values() || [])].map(({ participant, sockets }) => ({ ...participant, connected: sockets.size > 0 }))
}

function roomResponse(room, session) {
  return { room, sessionId: session.sessionId, participant: session.participant, topology: getTopology(room.id) }
}

function checkRevision(roomId, expectedRevision) {
  const room = getRoomById(roomId)
  if (!room) {
    const error = new Error('Room not found')
    error.statusCode = 404
    error.code = 'NOT_FOUND'
    throw error
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision !== room.revision) {
    const error = new Error('Your topology is out of date. Reload the latest revision before trying again.')
    error.statusCode = 409
    error.code = 'REVISION_CONFLICT'
    error.latest = getTopology(roomId)
    throw error
  }
  return room
}

const applyMutation = db.transaction(({ roomId, session, expectedRevision, operation, entity, id, payload }) => {
  if (!['owner', 'editor'].includes(session.role)) {
    const error = new Error('Viewer access cannot modify topology')
    error.statusCode = 403
    error.code = 'PERMISSION_DENIED'
    throw error
  }
  checkRevision(roomId, expectedRevision)
  const topology = getTopology(roomId)
  if (operation === 'create' && topology[`${entity}s`].length >= (entity === 'node' ? 500 : 1000)) {
    const error = new Error('Room capacity reached (500 devices / 1000 links)')
    error.statusCode = 400; error.code = 'ROOM_CAPACITY'; throw error
  }
  let result
  if (entity === 'node') {
    const parsed = operation === 'delete' ? null : parseOrThrow(nodeSchema, { ...payload, ...(id ? { id } : {}) })
    if (parsed?.data?.ipv4) {
      const duplicate = getTopology(roomId).nodes.find((node) => node.id !== id && node.data?.ipv4 === parsed.data.ipv4)
      if (duplicate) {
        const error = new Error(`IPv4 address ${parsed.data.ipv4} is already used by ${duplicate.label}`)
        error.statusCode = 400
        error.code = 'DUPLICATE_IPV4'
        throw error
      }
    }
    if (operation === 'create') result = insertNode(roomId, parsed, session.id)
    if (operation === 'update') result = updateNode(roomId, id, parsed, session.id)
    if (operation === 'delete') {
      const topology = getTopology(roomId)
      const edgeIds = topology.edges
        .filter((edge) => edge.sourceNodeId === id || edge.targetNodeId === id)
        .map((edge) => edge.id)
      result = removeNode(roomId, id) ? { id, edgeIds } : null
    }
  }
  if (entity === 'edge') {
    const parsed = operation === 'delete' ? null : parseOrThrow(edgeSchema, { ...payload, ...(id ? { id } : {}) })
    if (parsed && !getTopology(roomId).nodes.some((node) => node.id === parsed.sourceNodeId) || parsed && !getTopology(roomId).nodes.some((node) => node.id === parsed.targetNodeId)) {
      const error = new Error('Edge endpoints must exist in this room')
      error.statusCode = 400
      error.code = 'INVALID_EDGE_ENDPOINT'
      throw error
    }
    if (operation === 'create') result = insertEdge(roomId, parsed, session.id)
    if (operation === 'update') result = updateEdge(roomId, id, parsed, session.id)
    if (operation === 'delete') result = removeEdge(roomId, id) ? { id } : null
  }
  if (!result) {
    const error = new Error(`${entity} not found`)
    error.statusCode = 404
    error.code = 'NOT_FOUND'
    throw error
  }
  const room = bumpRevision(roomId)
  return { room, result }
})

function broadcastMutation(roomId, event, payload) {
  io.to(`room:${roomId}`).emit(event, payload)
  io.to(`room:${roomId}`).emit('topology:revision', { revision: payload.room.revision, updatedAt: payload.room.updatedAt })
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'netaxis-topology', time: new Date().toISOString() }))
registerPlanningApi(app, { requireSession, requireRoomAccess, requireEditor, sendError })

app.get('/api/rooms', (req, res) => res.json({ rooms: listAccessibleRooms(hash(browserToken(req))).map(({ id, name, joinCode, description, accessMode, revision, updatedAt }) => ({ id, name, joinCode, description, accessMode, revision, updatedAt })) }))

app.get('/api/session', (req, res) => {
  const participant = getSession(req)
  if (!participant) return res.status(401).json({ error: 'SESSION_EXPIRED', message: 'Session expired; please join your room again.' })
  res.json(roomResponse(getRoomById(participant.roomId), { sessionId: browserToken(req), participant }))
})
app.post('/api/session/leave', (_req, res) => { setCookie(res, 'netaxis-room', '', 0); res.status(204).end() })
app.post('/api/rooms/:roomId/resume', requireSession, requireRoomAccess, (req, res) => {
  setCookie(res, 'netaxis-room', req.room.id)
  res.json(roomResponse(req.room, { sessionId: browserToken(req), participant: req.session }))
})

app.post('/api/rooms', (req, res) => {
  try {
    const input = parseOrThrow(roomCreateSchema, req.body)
    const room = createRoom(input)
    const session = createSession({ roomId: room.id, displayName: input.displayName, role: 'owner' }, req, res)
    res.status(201).json({ ...roomResponse(room, session), recoveryKey: issueOwnerKey(room.id) })
  } catch (error) { sendError(res, error) }
})

app.post('/api/rooms/join', (req, res) => {
  try {
    const input = parseOrThrow(roomJoinSchema, req.body)
    const room = getRoomByJoinCode(input.joinCode)
    if (!room) return res.status(404).json({ error: 'NOT_FOUND', message: 'Room code not found' })
    if (input.recoveryKey && !ownerKeyValid(room.id, input.recoveryKey)) return res.status(403).json({ error: 'INVALID_RECOVERY_KEY', message: 'รหัสกู้สิทธิ์เจ้าของห้องไม่ถูกต้อง' })
    const role = input.recoveryKey ? 'owner' : room.accessMode === 'viewer' ? 'viewer' : input.role
    const session = createSession({ roomId: room.id, displayName: input.displayName, role }, req, res)
    return res.json(roomResponse(room, session))
  } catch (error) { return sendError(res, error) }
})

app.get('/api/rooms/:roomId', requireSession, requireRoomAccess, (req, res) => res.json(getTopology(req.params.roomId)))
app.post('/api/rooms/:roomId/recovery', requireSession, requireRoomAccess, (req, res) => {
  if (req.session.role !== 'owner') return res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Only an owner can issue a recovery key' })
  res.json({ recoveryKey: issueOwnerKey(req.room.id) })
})

app.patch('/api/rooms/:roomId', requireSession, requireRoomAccess, (req, res) => {
  try {
    if (req.session.role !== 'owner') return res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Only the room owner can update room settings' })
    const changes = parseOrThrow(roomPatchSchema, req.body)
    const room = updateRoom(req.params.roomId, changes)
    if (changes.accessMode === 'viewer') {
      db.prepare("UPDATE room_access SET role = 'viewer' WHERE room_id = ? AND role = 'editor'").run(room.id)
      for (const entry of roomParticipants.get(room.id)?.values() || []) if (entry.participant.role === 'editor') entry.participant.role = 'viewer'
      io.to(`room:${room.id}`).emit('room:presence', { participants: participantsFor(room.id) })
    }
    io.to(`room:${room.id}`).emit('room:updated', { room })
    res.json({ room })
  } catch (error) { sendError(res, error) }
})

app.delete('/api/rooms/:roomId', requireSession, requireRoomAccess, (req, res) => {
  if (req.session.role !== 'owner') return res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Only the room owner can delete the room' })
  removeRoom(req.params.roomId)
  io.to(`room:${req.params.roomId}`).emit('room:deleted')
  io.in(`room:${req.params.roomId}`).disconnectSockets(true)
  roomParticipants.delete(req.params.roomId)
  return res.status(204).end()
})

app.get('/api/rooms/:roomId/presence', requireSession, requireRoomAccess, (req, res) => res.json({ participants: participantsFor(req.params.roomId) }))

app.post('/api/rooms/:roomId/topology/import', requireSession, requireRoomAccess, requireEditor, (req, res) => {
  try {
    checkRevision(req.params.roomId, Number(req.get('x-topology-revision')))
    if (!Array.isArray(req.body?.nodes) || !Array.isArray(req.body?.edges) || req.body.nodes.length > 500 || req.body.edges.length > 1000) {
      const error = new Error('Import must contain nodes and edges arrays within the allowed size')
      error.statusCode = 400; error.code = 'INVALID_IMPORT'; throw error
    }
    const nodes = req.body.nodes.map((node) => parseOrThrow(nodeSchema, node))
    const nodeIds = new Set(nodes.map((node) => node.id))
    const edges = req.body.edges.map((edge) => parseOrThrow(edgeSchema, edge))
    if (nodes.some((node) => !node.id) || edges.some((edge) => !edge.id) || nodeIds.size !== nodes.length || new Set(edges.map((edge) => edge.id)).size !== edges.length) {
      const error = new Error('Import requires unique IDs for every device and link')
      error.statusCode = 400; error.code = 'INVALID_IMPORT'; throw error
    }
    if (nodes.some((node) => node.data?.ipv4 && nodes.some((other) => other !== node && other.data?.ipv4 === node.data.ipv4)) || edges.some((edge) => !nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId))) {
      const error = new Error('Import contains duplicate IPv4 addresses or invalid edge endpoints')
      error.statusCode = 400; error.code = 'INVALID_IMPORT'; throw error
    }
    // Exports can be imported into another room without colliding with global IDs.
    const remapped = new Map()
    for (const node of nodes) {
      if (db.prepare('SELECT 1 FROM nodes WHERE id = ? AND room_id != ?').get(node.id, req.params.roomId)) {
        const newId = `node_${nanoid(12)}`; remapped.set(node.id, newId); node.id = newId
      }
    }
    for (const edge of edges) {
      edge.sourceNodeId = remapped.get(edge.sourceNodeId) || edge.sourceNodeId
      edge.targetNodeId = remapped.get(edge.targetNodeId) || edge.targetNodeId
      if (db.prepare('SELECT 1 FROM edges WHERE id = ? AND room_id != ?').get(edge.id, req.params.roomId)) edge.id = `edge_${nanoid(12)}`
    }
    const updatedRoom = db.transaction(() => {
      checkRevision(req.params.roomId, Number(req.get('x-topology-revision')))
      replaceTopology(req.params.roomId, nodes, edges, req.session.id)
      return bumpRevision(req.params.roomId)
    })()
    const result = { room: updatedRoom, nodes: getTopology(req.params.roomId).nodes, edges: getTopology(req.params.roomId).edges }
    io.to(`room:${req.params.roomId}`).emit('room:sync', result)
    return res.json(result)
  } catch (error) {
    if (error.latest) return res.status(error.statusCode).json({ error: error.code, message: error.message, latest: error.latest })
    return sendError(res, error)
  }
})

function registerRestMutation(method, route, entity, operation) {
  app[method](route, requireSession, requireRoomAccess, requireEditor, (req, res) => {
    try {
      const payload = operation === 'delete' ? {} : req.body
      const result = applyMutation({ roomId: req.params.roomId, session: req.session, expectedRevision: Number(req.get('x-topology-revision')), operation, entity, id: req.params.id, payload })
      const event = `${entity}:${operation}`
      const message = { room: result.room, [entity]: result.result, actorId: req.session.id }
      broadcastMutation(req.params.roomId, event, message)
      res.status(operation === 'create' ? 201 : 200).json(message)
    } catch (error) {
      if (error.latest) return res.status(error.statusCode).json({ error: error.code, message: error.message, latest: error.latest })
      return sendError(res, error)
    }
  })
}

registerRestMutation('post', '/api/rooms/:roomId/nodes', 'node', 'create')
registerRestMutation('patch', '/api/rooms/:roomId/nodes/:id', 'node', 'update')
registerRestMutation('delete', '/api/rooms/:roomId/nodes/:id', 'node', 'delete')
registerRestMutation('post', '/api/rooms/:roomId/edges', 'edge', 'create')
registerRestMutation('patch', '/api/rooms/:roomId/edges/:id', 'edge', 'update')
registerRestMutation('delete', '/api/rooms/:roomId/edges/:id', 'edge', 'delete')

io.use((socket, next) => {
  const { sessionId, roomId } = socket.handshake.auth || {}
  if (typeof roomId !== 'string' || roomId.length > 80 || (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length > 256))) return next(new Error('Session is invalid or expired'))
  const session = sessionFor(sessionId || cookies(socket.request)['netaxis-session'], roomId)
  if (!session || !getRoomById(roomId)) return next(new Error('Session is invalid or expired'))
  if ((roomParticipants.get(roomId)?.get(session.id)?.sockets.size || 0) >= 8) return next(new Error('Too many active tabs for this room'))
  socket.session = session
  socket.sessionToken = sessionId || cookies(socket.request)['netaxis-session']
  socket.roomId = roomId
  return next()
})

io.on('connection', (socket) => {
  const { roomId, session } = socket
  if (!roomParticipants.has(roomId)) roomParticipants.set(roomId, new Map())
  const entry = roomParticipants.get(roomId).get(session.id) || { participant: session, sockets: new Set() }
  roomParticipants.get(roomId).set(session.id, entry)
  entry.sockets.add(socket.id)
  entry.participant.connected = true
  let windowStart = Date.now(), mutationCount = 0
  let syncWindow = Date.now(), syncCount = 0
  socket.join(`room:${roomId}`)
  socket.emit('room:sync', { ...getTopology(roomId), participants: participantsFor(roomId) })
  io.to(`room:${roomId}`).emit('room:presence', { participants: participantsFor(roomId) })

  function canSync() {
    if (Date.now() - syncWindow >= 60_000) { syncWindow = Date.now(); syncCount = 0 }
    if (!sessionFor(socket.sessionToken, roomId)) { socket.disconnect(true); return false }
    return ++syncCount <= 30
  }
  socket.on('room:join', () => { if (canSync()) socket.emit('room:sync', { ...getTopology(roomId), participants: participantsFor(roomId) }) })
  socket.on('room:presence', () => { if (canSync()) socket.emit('room:presence', { participants: participantsFor(roomId) }) })

  for (const entity of ['node', 'edge']) {
    for (const operation of ['create', 'update', 'delete']) {
      socket.on(`${entity}:${operation}`, (input, callback = () => {}) => {
        if (typeof callback !== 'function') callback = () => {}
        try {
          if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); mutationCount = 0 }
          if (++mutationCount > 120) return callback({ ok: false, error: 'RATE_LIMIT', message: 'Too many edits; please wait a minute.' })
          const currentSession = sessionFor(socket.sessionToken, roomId)
          if (!currentSession) { socket.disconnect(true); return }
          if (!input || typeof input !== 'object' || (operation !== 'create' && typeof input.id !== 'string')) {
            return callback({ ok: false, error: 'VALIDATION_ERROR', message: 'Mutation payload is invalid' })
          }
          const result = applyMutation({ roomId, session: currentSession, expectedRevision: input?.expectedRevision, operation, entity, id: input?.id, payload: input?.payload || input })
          const message = { room: result.room, [entity]: result.result, actorId: currentSession.id }
          broadcastMutation(roomId, `${entity}:${operation}`, message)
          callback({ ok: true, ...message })
        } catch (error) {
          callback({ ok: false, error: error.code || 'SERVER_ERROR', message: error.statusCode ? error.message : 'Unable to save this edit', latest: error.latest })
        }
      })
    }
  }

  socket.on('disconnect', () => {
    entry.sockets.delete(socket.id)
    if (!entry.sockets.size) roomParticipants.get(roomId)?.delete(session.id)
    if (!roomParticipants.get(roomId)?.size) roomParticipants.delete(roomId)
    io.to(`room:${roomId}`).emit('room:presence', { participants: participantsFor(roomId) })
  })
})

app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'API endpoint not found' }))
const distDirectory = fileURLToPath(new URL('../../dist', import.meta.url))
if (production && !fs.existsSync(path.join(distDirectory, 'index.html'))) throw new Error('Build the frontend with npm run build before starting production.')
app.use(express.static(distDirectory, { index: 'index.html', setHeaders: (res, filename) => {
  res.set('Cache-Control', filename.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
} }))
app.get('*', (_req, res, next) => fs.existsSync(path.join(distDirectory, 'index.html')) ? res.sendFile(path.join(distDirectory, 'index.html')) : next())
app.use((error, _req, res, _next) => sendError(res, error))
const cleanup = setInterval(() => {
  for (const socket of io.sockets.sockets.values()) {
    if (!sessionFor(socket.sessionToken, socket.roomId)) { socket.emit('session:ended'); socket.disconnect(true) }
  }
  db.prepare('DELETE FROM room_access WHERE expires_at <= ?').run(Date.now())
}, 60_000)
cleanup.unref()
httpServer.requestTimeout = 30_000
httpServer.headersTimeout = 15_000

httpServer.listen(PORT, HOST, () => {
  const interfaces = Object.values(os.networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal)
  const port = httpServer.address().port
  console.log(`NetAxis server listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${port}`)
  if (interfaces.length && !production) console.log(`LAN access: http://${interfaces[0].address}:${port}`)
})

export function closeServer() {
  clearInterval(cleanup)
  return new Promise((resolve) => io.close(() => { if (db.open) db.close(); resolve() }))
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { closeServer().then(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref() })
export { app, httpServer, io }
