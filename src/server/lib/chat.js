import { z } from 'zod'
import { parseOrThrow } from './validation.js'

export const CHAT_LIMIT = 100
export function chatInput(input) {
  return parseOrThrow(z.object({ text: z.string().trim().min(1).max(1000), clientId: z.string().min(8).max(80).regex(/^[\w-]+$/) }), input)
}
export function chatCursor(value = 0) {
  return parseOrThrow(z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER), value)
}
export function chatRate(limit = {}, time = Date.now()) {
  const start = limit.windowStart || 0, count = time - start < 60_000 ? (limit.count || 0) : 0
  if (time - (limit.lastSentAt || 0) < 1000 || count >= 20) throw Object.assign(new Error('ส่งข้อความเร็วเกินไป กรุณารอสักครู่ (สูงสุด 20 ข้อความต่อนาที)'), { statusCode: 429, code: 'CHAT_RATE_LIMIT' })
  return { lastSentAt: time, windowStart: count ? start : time, count: count + 1 }
}
export function newMessage(input, member, id) {
  return { id, clientId: input.clientId, text: input.text, participantId: member.id, displayName: member.displayName, role: member.role, createdAt: new Date().toISOString() }
}
export function memberStatus(input) {
  return parseOrThrow(z.object({ status: z.enum(['online', 'away', 'busy']) }), input).status
}
