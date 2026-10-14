import {fixtureAccount,fixtureAccountCookie} from './accounts.js'
export {fixtureAccountCookie} from './accounts.js'
import path from 'node:path'
import Database from 'better-sqlite3'
import { captchaDigest } from '../../src/server/lib/captcha.js'

// Integration fixtures change only their isolated database's challenge hash.
// The real endpoint still checks cookie binding, expiry and atomic consumption.
process.env.ROOM_ENTRY_LIMIT = '1000'
export async function captchaFetch(url, options = {}, databaseDirectory = process.env.DATA_DIR) {
  const target = new URL(url)
  const headers = new Headers(options.headers)
  const identifier = headers.get('x-session-id') || headers.get('cookie')?.match(/netaxis-session=([^;]+)/)?.[1]
  const existing = fixtureAccountCookie(identifier)
  if(existing)headers.set('cookie',[headers.get('cookie'),existing].filter(Boolean).join('; '))
  options={...options,headers}
  const entry=options.method==='POST' && ['/api/rooms','/api/rooms/join','/api/rooms/restore'].includes(target.pathname)
  if(!entry)return globalThis.fetch(url,options)
  if(!headers.get('cookie')?.includes('netaxis-account=')) {const account=await fixtureAccount(databaseDirectory);headers.set('cookie',[headers.get('cookie'),account.cookie].filter(Boolean).join('; '))}
  let body
  try { body = JSON.parse(options.body) } catch { return globalThis.fetch(url,options) }
  if(body.captcha)return globalThis.fetch(url,options)
  const response = await globalThis.fetch(new URL('/api/captcha', target), { headers })
  if (!response.ok) return response
  const challenge = await response.json(), answer = '123456'
  const db = new Database(path.join(databaseDirectory, 'netaxis.sqlite'))
  try { db.prepare('UPDATE captcha_challenges SET answer_hash=? WHERE id=?').run(captchaDigest(challenge.id, answer), challenge.id) } finally { db.close() }
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  headers.set('cookie', [headers.get('cookie'), cookie].filter(Boolean).join('; '))
  const verification = await globalThis.fetch(new URL('/api/captcha/verify', target), { method: 'POST', headers, body: JSON.stringify({ captcha: { id: challenge.id, answer } }) })
  if (!verification.ok) return verification
  headers.set('cookie', [headers.get('cookie'), verification.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')].filter(Boolean).join('; '))
  return globalThis.fetch(url, { ...options, headers, body: JSON.stringify(body) })
}
