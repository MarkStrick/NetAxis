import { accountTables } from '../lib/accounts.js'
import { deviceModels } from '../../shared/devices.js'
import pg from 'pg'
import { customAlphabet } from 'nanoid'

const joinCode = customAlphabet('0123456789', 4)

export function postgresDriver(connectionString) {
  if (!connectionString) throw new Error('Connect a Neon Postgres database in Vercel Storage and set DATABASE_URL.')
  const pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, allowExitOnIdle: true })
  pool.on('error', error => console.error('Postgres connection error:', error.code || 'CONNECTION_ERROR'))
  return {
    query: (sql, values) => pool.query(sql, values),
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SET LOCAL statement_timeout = '15000ms'")
        await client.query("SET LOCAL lock_timeout = '10000ms'")
        const value = await fn(client)
        await client.query('COMMIT'); return value
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
      finally { client.release() }
    },
    close: () => pool.end(),
  }
}

// Each room is a bounded document. A row lock makes its topology, plan, members
// and probe jobs atomic across independent function instances. No process cache.
export class CloudStore {
  constructor(driver) { this.driver = driver; this.ready = null }
  async init() {
    if (!this.ready) this.ready = this.driver.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(684202610)')
      for (const sql of accountTables.split(';').filter(sql => sql.trim())) await client.query(sql)
      await client.query(`CREATE TABLE IF NOT EXISTS netaxis_cloud_rooms (
        id TEXT PRIMARY KEY, join_code TEXT NOT NULL UNIQUE, expires_at BIGINT NOT NULL,
        member_tokens TEXT[] NOT NULL, probe_ids TEXT[] NOT NULL DEFAULT '{}', state JSONB NOT NULL
      )`)
      const legacy = await client.query("SELECT id FROM netaxis_cloud_rooms WHERE join_code !~ '^[0-9]{4}$'")
      if (legacy.rows.length) {
        await client.query('LOCK TABLE netaxis_cloud_rooms IN SHARE ROW EXCLUSIVE MODE')
        const rooms = (await client.query('SELECT id, join_code FROM netaxis_cloud_rooms')).rows
        const used = new Set(rooms.map(room => room.join_code))
        let next = 0
        for (const room of rooms.filter(room => !/^\d{4}$/.test(room.join_code))) {
          while (used.has(String(next).padStart(4, '0'))) next++
          if (next >= 10000) throw new Error('All four-digit room codes are in use.')
          const code = String(next++).padStart(4, '0')
          await client.query("UPDATE netaxis_cloud_rooms SET join_code=$1, state=jsonb_set(state, '{room,joinCode}', to_jsonb($1::text)) WHERE id=$2", [code, room.id])
          used.add(code)
        }
      }
      await client.query('CREATE INDEX IF NOT EXISTS netaxis_cloud_members ON netaxis_cloud_rooms USING GIN(member_tokens)')
      await client.query('CREATE INDEX IF NOT EXISTS netaxis_cloud_probes ON netaxis_cloud_rooms USING GIN(probe_ids)')
      await client.query('CREATE INDEX IF NOT EXISTS netaxis_cloud_expiry ON netaxis_cloud_rooms(expires_at)')
      await client.query(`CREATE TABLE IF NOT EXISTS netaxis_cloud_presence (
        room_id TEXT NOT NULL REFERENCES netaxis_cloud_rooms(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL, tab_id TEXT NOT NULL, seen_at BIGINT NOT NULL,
        PRIMARY KEY(room_id, participant_id, tab_id)
      )`)
      await client.query(`CREATE TABLE IF NOT EXISTS netaxis_cloud_captcha (
        id TEXT PRIMARY KEY, answer_hash TEXT NOT NULL, binding_hash TEXT NOT NULL, expires_at BIGINT NOT NULL
      )`)
      await client.query('CREATE INDEX IF NOT EXISTS netaxis_cloud_captcha_expiry ON netaxis_cloud_captcha(expires_at)')
      await client.query('CREATE TABLE IF NOT EXISTS netaxis_cloud_visitors (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL)')
      await client.query('CREATE TABLE IF NOT EXISTS netaxis_device_models (id TEXT PRIMARY KEY, metadata JSONB NOT NULL)')
      await client.query(`INSERT INTO netaxis_device_models (id,metadata) SELECT value->>'id',value FROM jsonb_array_elements($1::jsonb) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata`, [JSON.stringify(deviceModels)])
      await client.query('CREATE INDEX IF NOT EXISTS netaxis_cloud_visitors_expiry ON netaxis_cloud_visitors(expires_at)')
    }).catch(error => { this.ready = null; throw error })
    await this.ready
  }
  async listDeviceModels() { await this.init(); return (await this.driver.query('SELECT metadata FROM netaxis_device_models ORDER BY id')).rows.map(row => row.metadata) }
  async transaction(fn) { await this.init(); return this.driver.transaction(fn) }
  async find(key, value, client = this.driver, lock = false) {
    await this.init()
    const predicates = { id: 'id=$1', code: 'join_code=$1', probe: 'probe_ids @> ARRAY[$1]::text[]' }
    if (!predicates[key]) throw new Error('Invalid room lookup')
    const result = await client.query(`SELECT state FROM netaxis_cloud_rooms WHERE ${predicates[key]}${lock ? ' FOR UPDATE' : ''}`, [value])
    return result.rows[0]?.state || null
  }
  async save(state, client, create = false) {
    const finished = state.jobs.filter(job => ['completed', 'failed'].includes(job.state)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const keep = new Set(finished.slice(0, 100).map(job => job.id))
    state.jobs = state.jobs.filter(job => !['completed', 'failed'].includes(job.state) || keep.has(job.id))
    const values = [state.room.id, state.room.joinCode, (state.room.expiresAt ? Date.parse(state.room.expiresAt) : 253402300799000), Object.keys(state.members), state.probes.map(p => p.id), JSON.stringify(state)]
    if (Buffer.byteLength(values[5]) > 8 * 1024 * 1024) { const error = new Error('Workspace storage limit reached. Export a backup and remove unused probe history.'); error.statusCode = 413; throw error }
    if (create) {
      for (let attempts = 0; ; attempts++) {
        const result = await client.query('INSERT INTO netaxis_cloud_rooms (id,join_code,expires_at,member_tokens,probe_ids,state) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (join_code) DO NOTHING RETURNING id', values)
        if (result.rows.length) break
        if (attempts >= 100) throw new Error('Unable to allocate room code. Please try again.')
        state.room.joinCode = joinCode()
        values[1] = state.room.joinCode
        values[5] = JSON.stringify(state)
      }
    }
    else await client.query('UPDATE netaxis_cloud_rooms SET join_code=$2,expires_at=$3,member_tokens=$4,probe_ids=$5,state=$6 WHERE id=$1', values)
  }
  async list(tokenHash) {
    await this.init()
    const result = await this.driver.query("SELECT state->'room' AS room, state->'members'->($1::text) AS member FROM netaxis_cloud_rooms WHERE member_tokens @> ARRAY[$1]::text[] AND expires_at > $2 ORDER BY state->'room'->>'updatedAt' DESC LIMIT 100", [tokenHash, Date.now()])
    return result.rows.filter(row => row.member?.expiresAt > Date.now()).map(row => row.room)
  }
  async presence(state, client = this.driver) {
    const rows = await client.query('SELECT DISTINCT participant_id FROM netaxis_cloud_presence WHERE room_id=$1 AND seen_at>$2', [state.room.id, Date.now() - 45000])
    const active = new Set(rows.rows.map(row => row.participant_id))
    return Object.values(state.members).filter(m => m.expiresAt > Date.now()).map(m => {
      const connected = active.has(m.participant.id)
      return { ...m.participant, connected, status: connected ? (m.status || 'online') : 'offline' }
    })
  }
}
