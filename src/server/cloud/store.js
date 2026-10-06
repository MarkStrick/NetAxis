import pg from 'pg'

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
      await client.query(`CREATE TABLE IF NOT EXISTS netaxis_cloud_rooms (
        id TEXT PRIMARY KEY, join_code TEXT NOT NULL UNIQUE, expires_at BIGINT NOT NULL,
        member_tokens TEXT[] NOT NULL, probe_ids TEXT[] NOT NULL DEFAULT '{}', state JSONB NOT NULL
      )`)
      await client.query('CREATE INDEX IF NOT EXISTS netaxis_cloud_members ON netaxis_cloud_rooms USING GIN(member_tokens)')
      await client.query('CREATE INDEX IF NOT EXISTS netaxis_cloud_probes ON netaxis_cloud_rooms USING GIN(probe_ids)')
      await client.query('CREATE INDEX IF NOT EXISTS netaxis_cloud_expiry ON netaxis_cloud_rooms(expires_at)')
      await client.query(`CREATE TABLE IF NOT EXISTS netaxis_cloud_presence (
        room_id TEXT NOT NULL REFERENCES netaxis_cloud_rooms(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL, tab_id TEXT NOT NULL, seen_at BIGINT NOT NULL,
        PRIMARY KEY(room_id, participant_id, tab_id)
      )`)
    }).catch(error => { this.ready = null; throw error })
    await this.ready
  }
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
    const values = [state.room.id, state.room.joinCode, Date.parse(state.room.expiresAt), Object.keys(state.members), state.probes.map(p => p.id), JSON.stringify(state)]
    if (Buffer.byteLength(values[5]) > 8 * 1024 * 1024) { const error = new Error('Workspace storage limit reached. Export a backup and remove unused probe history.'); error.statusCode = 413; throw error }
    if (create) await client.query('INSERT INTO netaxis_cloud_rooms (id,join_code,expires_at,member_tokens,probe_ids,state) VALUES ($1,$2,$3,$4,$5,$6)', values)
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
    return Object.values(state.members).filter(m => m.expiresAt > Date.now() && active.has(m.participant.id)).map(m => ({ ...m.participant, connected: true }))
  }
}
