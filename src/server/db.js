import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { nanoid, customAlphabet } from 'nanoid'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { ROOM_LIFETIME_MS } from '../shared/room-lifetime.js'

const dataDirectory = path.resolve(process.env.DATA_DIR || fileURLToPath(new URL('../../data', import.meta.url)))
fs.mkdirSync(dataDirectory, { recursive: true })

export const db = new Database(path.join(dataDirectory, 'netaxis.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    join_code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    access_mode TEXT NOT NULL DEFAULT 'editor',
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    medium TEXT NOT NULL DEFAULT 'ethernet',
    bandwidth TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'unknown',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_nodes_room ON nodes(room_id);
  CREATE INDEX IF NOT EXISTS idx_edges_room ON edges(room_id);
  CREATE TABLE IF NOT EXISTS room_access (
    token_hash TEXT NOT NULL,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'viewer')),
    connected_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (token_hash, room_id)
  );
  CREATE INDEX IF NOT EXISTS idx_access_expiry ON room_access(expires_at);
  CREATE TABLE IF NOT EXISTS room_templates (
    room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    info_json TEXT NOT NULL
  );
`)

// Additive migration preserves existing topology databases.
const edgeColumns = db.prepare('PRAGMA table_info(edges)').all().map((column) => column.name)
for (const column of ['source_side', 'target_side']) {
  if (!edgeColumns.includes(column)) db.exec(`ALTER TABLE edges ADD COLUMN ${column} TEXT`)
}
const joinCode = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 10)
if (!db.prepare('PRAGMA table_info(rooms)').all().some(column => column.name === 'owner_key_hash')) db.exec('ALTER TABLE rooms ADD COLUMN owner_key_hash TEXT')
if (!db.prepare('PRAGMA table_info(rooms)').all().some(column => column.name === 'expires_at')) db.exec('ALTER TABLE rooms ADD COLUMN expires_at TEXT')
// Existing rooms receive a full day from the first upgrade; subsequent restarts preserve it.
db.prepare('UPDATE rooms SET expires_at = ? WHERE expires_at IS NULL').run(new Date(Date.now() + ROOM_LIFETIME_MS).toISOString())
db.exec('CREATE INDEX IF NOT EXISTS idx_rooms_expiry ON rooms(expires_at)')
export function issueOwnerKey(roomId) {
  const key = nanoid(40)
  const result = db.prepare('UPDATE rooms SET owner_key_hash = ? WHERE id = ?').run(createHash('sha256').update(key).digest('hex'), roomId)
  if (!result.changes) throw new Error('Room not found')
  return key
}
export function ownerKeyValid(roomId, key) {
  return Boolean(key && db.prepare('SELECT 1 FROM rooms WHERE id = ? AND owner_key_hash = ?').get(roomId, createHash('sha256').update(key).digest('hex')))
}

const now = () => new Date().toISOString()
const createId = (prefix) => `${prefix}_${nanoid(12)}`

export function createRoom({ name, description = '', accessMode = 'editor' }) {
  const createdAt = now()
  const room = {
    id: createId('room'),
    name,
    joinCode: joinCode(),
    description,
    accessMode,
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.parse(createdAt) + ROOM_LIFETIME_MS).toISOString(),
  }
  db.prepare(`INSERT INTO rooms (id, name, join_code, description, access_mode, revision, created_at, updated_at, expires_at)
    VALUES (@id, @name, @joinCode, @description, @accessMode, @revision, @createdAt, @updatedAt, @expiresAt)`).run(room)
  return room
}

function mapRoom(row) {
  if (!row) return null
  return { id: row.id, name: row.name, joinCode: row.join_code, description: row.description, accessMode: row.access_mode, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at }
}

function mapNode(row) {
  return { id: row.id, roomId: row.room_id, type: row.type, label: row.label, position: { x: row.position_x, y: row.position_y }, data: JSON.parse(row.data_json), createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: row.updated_by || undefined }
}

function mapEdge(row) {
  return { id: row.id, roomId: row.room_id, sourceNodeId: row.source_node_id, targetNodeId: row.target_node_id, sourceSide: row.source_side || undefined, targetSide: row.target_side || undefined, label: row.label, medium: row.medium, bandwidth: row.bandwidth, status: row.status, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: row.updated_by || undefined }
}

export function getRoomById(id) { return mapRoom(db.prepare('SELECT * FROM rooms WHERE id = ?').get(id)) }
export function getRoomByJoinCode(joinCode) { return mapRoom(db.prepare('SELECT * FROM rooms WHERE join_code = ?').get(joinCode.toUpperCase())) }
export function listRooms() { return db.prepare('SELECT * FROM rooms ORDER BY updated_at DESC').all().map(mapRoom) }
export function listAccessibleRooms(tokenHash) {
  return db.prepare('SELECT rooms.* FROM rooms JOIN room_access ON room_access.room_id = rooms.id WHERE room_access.token_hash = ? AND room_access.expires_at > ? AND rooms.expires_at > ? ORDER BY rooms.updated_at DESC').all(tokenHash, Date.now(), now()).map(mapRoom)
}
export function getNodes(roomId) { return db.prepare('SELECT * FROM nodes WHERE room_id = ? ORDER BY created_at ASC').all(roomId).map(mapNode) }
export function getEdges(roomId) { return db.prepare('SELECT * FROM edges WHERE room_id = ? ORDER BY created_at ASC').all(roomId).map(mapEdge) }
export function getTopology(roomId) {
  const room = getRoomById(roomId)
  const template = db.prepare('SELECT info_json FROM room_templates WHERE room_id = ?').get(roomId)
  return room ? { room, nodes: getNodes(roomId), edges: getEdges(roomId), template: template ? JSON.parse(template.info_json) : null } : null
}

export function updateRoom(id, changes) {
  const current = getRoomById(id)
  if (!current) return null
  const updated = { ...current, ...changes, updatedAt: now() }
  db.prepare('UPDATE rooms SET name = ?, description = ?, access_mode = ?, updated_at = ? WHERE id = ?').run(updated.name, updated.description, updated.accessMode, updated.updatedAt, id)
  return getRoomById(id)
}

export function removeRoom(id) { return db.prepare('DELETE FROM rooms WHERE id = ?').run(id).changes > 0 }

export function bumpRevision(roomId) {
  const updatedAt = now()
  db.prepare('UPDATE rooms SET revision = revision + 1, updated_at = ? WHERE id = ?').run(updatedAt, roomId)
  return getRoomById(roomId)
}

export function insertNode(roomId, input, updatedBy) {
  const timestamp = now()
  const node = { ...input, id: input.id || createId('node'), roomId, createdAt: timestamp, updatedAt: timestamp, updatedBy }
  db.prepare(`INSERT INTO nodes (id, room_id, type, label, position_x, position_y, data_json, created_at, updated_at, updated_by)
    VALUES (@id, @roomId, @type, @label, @x, @y, @data, @createdAt, @updatedAt, @updatedBy)`).run({ ...node, x: node.position.x, y: node.position.y, data: JSON.stringify(node.data) })
  return mapNode(db.prepare('SELECT * FROM nodes WHERE id = ? AND room_id = ?').get(node.id, roomId))
}

export function updateNode(roomId, id, input, updatedBy) {
  const existing = db.prepare('SELECT * FROM nodes WHERE id = ? AND room_id = ?').get(id, roomId)
  if (!existing) return null
  const timestamp = now()
  const current = mapNode(existing)
  const node = { ...current, ...input, roomId, id, updatedAt: timestamp, updatedBy }
  db.prepare(`UPDATE nodes SET type = ?, label = ?, position_x = ?, position_y = ?, data_json = ?, updated_at = ?, updated_by = ? WHERE id = ? AND room_id = ?`)
    .run(node.type, node.label, node.position.x, node.position.y, JSON.stringify(node.data), timestamp, updatedBy || null, id, roomId)
  return mapNode(db.prepare('SELECT * FROM nodes WHERE id = ? AND room_id = ?').get(id, roomId))
}

export function removeNode(roomId, id) { return db.prepare('DELETE FROM nodes WHERE id = ? AND room_id = ?').run(id, roomId).changes > 0 }

export function insertEdge(roomId, input, updatedBy) {
  const timestamp = now()
  const edge = { ...input, sourceSide: input.sourceSide || null, targetSide: input.targetSide || null, id: input.id || createId('edge'), roomId, createdAt: timestamp, updatedAt: timestamp, updatedBy }
  db.prepare(`INSERT INTO edges (id, room_id, source_node_id, target_node_id, source_side, target_side, label, medium, bandwidth, status, notes, created_at, updated_at, updated_by)
    VALUES (@id, @roomId, @sourceNodeId, @targetNodeId, @sourceSide, @targetSide, @label, @medium, @bandwidth, @status, @notes, @createdAt, @updatedAt, @updatedBy)`).run(edge)
  return mapEdge(db.prepare('SELECT * FROM edges WHERE id = ? AND room_id = ?').get(edge.id, roomId))
}

export function updateEdge(roomId, id, input, updatedBy) {
  const existing = db.prepare('SELECT * FROM edges WHERE id = ? AND room_id = ?').get(id, roomId)
  if (!existing) return null
  const timestamp = now()
  const edge = { ...mapEdge(existing), ...input, roomId, id, updatedAt: timestamp, updatedBy }
  db.prepare(`UPDATE edges SET source_node_id = ?, target_node_id = ?, source_side = ?, target_side = ?, label = ?, medium = ?, bandwidth = ?, status = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ? AND room_id = ?`)
    .run(edge.sourceNodeId, edge.targetNodeId, edge.sourceSide || null, edge.targetSide || null, edge.label || '', edge.medium, edge.bandwidth || '', edge.status, edge.notes || '', timestamp, updatedBy || null, id, roomId)
  return mapEdge(db.prepare('SELECT * FROM edges WHERE id = ? AND room_id = ?').get(id, roomId))
}

export function removeEdge(roomId, id) { return db.prepare('DELETE FROM edges WHERE id = ? AND room_id = ?').run(id, roomId).changes > 0 }

export function replaceTopology(roomId, nodes, edges, updatedBy) {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM edges WHERE room_id = ?').run(roomId)
    db.prepare('DELETE FROM nodes WHERE room_id = ?').run(roomId)
    for (const node of nodes) insertNode(roomId, node, updatedBy)
    for (const edge of edges) insertEdge(roomId, edge, updatedBy)
  })
  transaction()
  return getTopology(roomId)
}

export function clearDatabaseForTests() {
  db.exec('DELETE FROM edges; DELETE FROM nodes; DELETE FROM rooms;')
}
