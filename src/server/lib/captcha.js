import { randomInt, timingSafeEqual } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { nanoid } from 'nanoid'
import { rateLimit } from 'express-rate-limit'
import { cookies, hash, setCookie } from './security.js'

const lifetime = 5 * 60_000
const visitorLifetime = 365 * 24 * 60 * 60_000
const glyphs = [
  '01110/10001/10011/10101/11001/10001/01110', '00100/01100/00100/00100/00100/00100/01110',
  '01110/10001/00001/00010/00100/01000/11111', '11110/00001/00001/01110/00001/00001/11110',
  '00010/00110/01010/10010/11111/00010/00010', '11111/10000/10000/11110/00001/00001/11110',
  '01110/10000/10000/11110/10001/10001/01110', '11111/00001/00010/00100/01000/01000/01000',
  '01110/10001/10001/01110/10001/10001/01110', '01110/10001/10001/01111/00001/00001/01110',
].map(glyph => glyph.split('/'))

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) }
  return (value ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}
// Raster pixels keep the answer out of HTML, SVG text, image metadata and JSON.
export function captchaImage(answer) {
  const width = 240, height = 72, pixels = Buffer.alloc(width * height * 3)
  for (let i = 0; i < pixels.length; i++) pixels[i] = randomInt(226, 251)
  const dot = (x, y, color) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < width && y >= 0 && y < height) { const at = (y * width + x) * 3; color.forEach((v, c) => { pixels[at + c] = v }) } }
  for (let line = 0; line < 6; line++) {
    const offset = randomInt(0, height), phase = randomInt(0, 30)
    for (let x = 0; x < width; x++) dot(x, offset + 8 * Math.sin((x + phase) / 30), [156, 177, 190])
  }
  for (const [index, digit] of [...answer].entries()) {
    const top = randomInt(10, 23), skew = randomInt(-4, 5) / 20, color = [randomInt(20, 65), randomInt(35, 85), randomInt(65, 110)]
    glyphs[Number(digit)].forEach((row, y) => [...row].forEach((on, x) => {
      if (on === '1') for (let dx = 0; dx < 5; dx++) for (let dy = 0; dy < 5; dy++) dot(15 + index * 37 + x * 5 + dx + (y * 5 + dy) * skew, top + y * 5 + dy, color)
    }))
  }
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
export const captchaDigest = (id, answer) => hash(`${id}:${answer}`)
export function registerCaptcha(app, repository) {
  const limiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.ROOM_ENTRY_LIMIT) || 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'RATE_LIMIT', message: 'ลองบ่อยเกินไป กรุณารอ 1 นาที' } })
  async function verified(req) {
    const token = cookies(req)['netaxis-verified']
    return Boolean(token && token.length <= 80 && await repository.visitorValid(hash(token), Date.now()))
  }
  app.get('/api/visitor', async (req, res, next) => {
    try { res.json({ verified: await verified(req) }) } catch (error) { next(error) }
  })
  app.get('/api/captcha', limiter, async (req, res, next) => {
    try {
      const binding = cookies(req)['netaxis-captcha'] || nanoid(32)
      if (binding.length > 80) return res.status(400).json({ error: 'CAPTCHA_INVALID', message: 'กรุณาลองโหลดรหัสใหม่' })
      const id = nanoid(32), answer = Array.from({ length: 6 }, () => randomInt(0, 10)).join(''), expiresAt = Date.now() + lifetime
      await repository.put({ id, answerHash: captchaDigest(id, answer), bindingHash: hash(binding), expiresAt })
      setCookie(res, 'netaxis-captcha', binding, lifetime)
      res.json({ id, image: captchaImage(answer), expiresAt })
    } catch (error) { next(error) }
  })
  app.post('/api/captcha/verify', limiter, async (req, res, next) => {
    try {
      const { id, answer } = req.body?.captcha || {}, binding = cookies(req)['netaxis-captcha']
      if (typeof id !== 'string' || id.length > 80 || typeof answer !== 'string' || !/^\d{6}$/.test(answer.trim()) || !binding || binding.length > 80) return res.status(400).json({ error: 'CAPTCHA_REQUIRED', message: 'กรุณากรอกรหัสยืนยัน 6 หลักจากภาพ' })
      // Atomic consume prevents replay even across parallel serverless instances.
      const record = await repository.take(id, hash(binding))
      const valid = record && record.expiresAt > Date.now() && timingSafeEqual(Buffer.from(record.answerHash, 'hex'), Buffer.from(captchaDigest(id, answer.trim()), 'hex'))
      if (!valid) return res.status(400).json({ error: 'CAPTCHA_INVALID', message: 'รหัสไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว กรุณากรอกภาพใหม่' })
      const token = nanoid(32), expiresAt = Date.now() + visitorLifetime
      await repository.putVisitor(hash(token), expiresAt)
      setCookie(res, 'netaxis-verified', token, visitorLifetime)
      res.json({ verified: true })
    } catch (error) { next(error) }
  })
  app.post(['/api/rooms', '/api/rooms/join', '/api/rooms/restore'], limiter, async (req, res, next) => {
    try {
      if (!await verified(req)) return res.status(403).json({ error: 'VISITOR_UNVERIFIED', message: 'กรุณายืนยันแคปช่าเมื่อเข้าเว็บครั้งแรก' })
      next()
    } catch (error) { next(error) }
  })
}
