export const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000
export function roomExpired(room, timestamp = Date.now()) {
  return Boolean(room?.expiresAt && Date.parse(room.expiresAt) <= timestamp)
}
export function roomTimeLeft(room, timestamp = Date.now()) {
  const expires = Date.parse(room?.expiresAt)
  if (!Number.isFinite(expires)) return ''
  const minutes = Math.max(0, Math.ceil((expires - timestamp) / 60_000))
  return minutes ? `เหลือ ${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที` : 'หมดอายุแล้ว'
}
