import { createHash } from 'node:crypto'
import { parseCookie } from 'cookie'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'

export const production = process.env.NODE_ENV === 'production'
const deploymentHost = process.env.VERCEL === '1' && (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL)
export const publicOrigin = process.env.PUBLIC_ORIGIN || (deploymentHost ? `https://${deploymentHost}` : '')
const deploymentOrigin = process.env.VERCEL === '1' && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
export const sessionLifetime = 30 * 24 * 60 * 60 * 1000
export const hash = (token) => createHash('sha256').update(token).digest('hex')
let validOrigin = false
try { const url = new URL(publicOrigin); validOrigin = url.protocol === 'https:' && url.origin === publicOrigin } catch { /* Missing or malformed configuration. */ }
if (production && !validOrigin) {
  throw new Error('Production requires PUBLIC_ORIGIN (https://your-domain, without a trailing slash).')
}
export const cookies = (req) => parseCookie(req.headers.cookie || '')
export const browserToken = (req) => req.get?.('x-session-id') || cookies(req)['netaxis-session'] || ''
export function setCookie(res, name, value, maxAge = sessionLifetime) {
  res.cookie(name, value, { httpOnly: true, secure: production, sameSite: 'strict', path: '/', maxAge })
}
export function originAllowed(origin, req) {
  if (!origin) return true
  if (publicOrigin) return origin === publicOrigin || origin === deploymentOrigin
  try { return new URL(origin).host === req.headers.host } catch { return false }
}
export function configureSecurity(app) {
  app.disable('x-powered-by')
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY)
  app.use(helmet({
    strictTransportSecurity: production ? undefined : false,
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: production ? ["'self'"] : ["'self'", 'ws:', 'wss:'],
      objectSrc: ["'none'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: production ? [] : null,
    } },
  }))
  app.use((req, res, next) => {
    if (!originAllowed(req.headers.origin, req)) return res.status(403).json({ error: 'ORIGIN_DENIED', message: 'Origin is not allowed' })
    next()
  })
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'RATE_LIMIT', message: 'Too many requests; please wait a minute.' } }))
}
