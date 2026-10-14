import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'
import { rateLimit } from 'express-rate-limit'
import { cookies, hash, setCookie, sessionLifetime } from './security.js'

const derive = promisify(scrypt)
const cost = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
})
export const accountTables = `CREATE TABLE IF NOT EXISTS netaxis_accounts (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,membership_token TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS netaxis_account_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES netaxis_accounts(id) ON DELETE CASCADE,expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS netaxis_auth_failures (email_hash TEXT PRIMARY KEY,attempts INTEGER NOT NULL,blocked_until BIGINT NOT NULL);`
// Room membership outlives login sessions; legacy tables require an expiry value.
export const persistentMembership = 253402300799000

export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await derive(password.normalize('NFC'), salt, 64, cost)
  return `scrypt:${salt}:${key.toString('hex')}`
}
async function verifyPassword(password, encoded) {
  const [, salt, key] = encoded.split(':')
  const actual = await derive(password.normalize('NFC'), salt, 64, cost)
  return timingSafeEqual(actual, Buffer.from(key, 'hex'))
}
const publicUser = user => ({ id: user.id, email: user.email })

export function accountRepository(query) {
  return {
    user: async email => (await query('SELECT * FROM netaxis_accounts WHERE email=?', [email])).rows[0],
    insert: async user => query('INSERT INTO netaxis_accounts VALUES (?,?,?,?)', [user.id, user.email, user.password_hash, user.membership_token]),
    async putSession(token, user) {
      await query('DELETE FROM netaxis_account_sessions WHERE expires_at<=?', [Date.now()])
      await query('DELETE FROM netaxis_auth_failures WHERE blocked_until<=?', [Date.now()])
      return query('INSERT INTO netaxis_account_sessions VALUES (?,?,?)', [hash(token), user.id, Date.now() + sessionLifetime])
    },
    session: async token => (await query('SELECT a.*,s.token_hash AS session_hash FROM netaxis_accounts a JOIN netaxis_account_sessions s ON s.user_id=a.id WHERE s.token_hash=? AND s.expires_at>?', [hash(token), Date.now()])).rows[0],
    logout: async token => query('DELETE FROM netaxis_account_sessions WHERE token_hash=?', [hash(token)]),
    blocked: async email => (await query('SELECT blocked_until FROM netaxis_auth_failures WHERE email_hash=?', [hash(email)])).rows[0]?.blocked_until > Date.now(),
    failure: async email => query(`INSERT INTO netaxis_auth_failures VALUES (?,1,?) ON CONFLICT(email_hash) DO UPDATE SET attempts=CASE WHEN netaxis_auth_failures.blocked_until<? THEN 1 ELSE netaxis_auth_failures.attempts+1 END,blocked_until=?`, [hash(email), Date.now() + 15 * 60_000, Date.now(), Date.now() + 15 * 60_000]),
    attempts: async email => (await query('SELECT attempts FROM netaxis_auth_failures WHERE email_hash=?', [hash(email)])).rows[0]?.attempts || 0,
    clearFailure: async email => query('DELETE FROM netaxis_auth_failures WHERE email_hash=?', [hash(email)]),
  }
}

export function registerAccounts(app, repository, { onLogout = () => {} } = {}) {
  const route = fn => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  const limiter = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'AUTH_RATE_LIMIT', message: 'ลองบ่อยเกินไป กรุณารอ 1 นาที' } })
  const accountToken = req => cookies(req)['netaxis-account'] || ''
  async function authenticate(req) {
    const token = accountToken(req)
    return token && token.length <= 128 ? repository.session(token) : null
  }
  app.get('/api/auth/me', route(async (req, res) => {
    const user = await authenticate(req)
    res.json({ user: user ? publicUser(user) : null })
  }))
  for (const action of ['register', 'login']) app.post('/api/auth/' + action, limiter, route(async (req, res) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'AUTH_INPUT', message: 'กรอกอีเมลให้ถูกต้อง และรหัสผ่าน 12–128 ตัวอักษร' })
    const { email, password } = parsed.data
    if (await repository.blocked(email) && await repository.attempts(email) >= 8) return res.status(429).json({ error: 'AUTH_LOCKED', message: 'ลองหลายครั้งเกินไป กรุณารอ 15 นาที' })
    let user = await repository.user(email)
    if (action === 'register') {
      if (user) return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ' })
      user = { id: 'account_' + randomBytes(16).toString('hex'), email, password_hash: await passwordHash(password), membership_token: randomBytes(32).toString('hex') }
      try { await repository.insert(user) }
      catch (error) {
        if (error.code === '23505' || error.code?.startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ' })
        throw error
      }
    } else {
      // Unknown emails take the same password-derivation cost as existing accounts.
      const encoded = user?.password_hash || 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64)
      if (!await verifyPassword(password, encoded) || !user) {
        await repository.failure(email)
        return res.status(401).json({ error: 'LOGIN_FAILED', message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' })
      }
    }
    await repository.clearFailure(email)
    const previous = accountToken(req)
    if (previous) { await repository.logout(previous); onLogout(hash(previous)) }
    const token = randomBytes(32).toString('hex')
    await repository.putSession(token, user)
    setCookie(res, 'netaxis-account', token)
    setCookie(res, 'netaxis-room', '', 0)
    setCookie(res, 'netaxis-session', '', 0)
    res.status(action === 'register' ? 201 : 200).json({ user: publicUser(user) })
  }))
  app.post('/api/auth/logout', route(async (req, res) => {
    const token = accountToken(req)
    if (token) { await repository.logout(token); onLogout(hash(token)) }
    for (const name of ['netaxis-account', 'netaxis-room', 'netaxis-session']) setCookie(res, name, '', 0)
    res.status(204).end()
  }))
  app.use(['/api/rooms', '/api/session'], async (req, res, next) => {
    try {
      req.account = await authenticate(req)
      if (!req.account) return res.status(401).json({ error: 'LOGIN_REQUIRED', message: 'กรุณาเข้าสู่ระบบก่อนเปิดห้อง' })
      // Preserve the client wire format without exposing the private membership token.
      const json = res.json.bind(res)
      res.json = value => json(value?.sessionId ? { ...value, sessionId: req.account.id } : value)
      next()
    } catch (error) { next(error) }
  })
  return { authenticate }
}
