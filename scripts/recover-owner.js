import { db, getRoomById, issueOwnerKey } from '../src/server/db.js'
const roomId = process.argv[2]
try {
  const room = roomId && getRoomById(roomId)
  if (!room) throw new Error('Usage: npm run recover-owner -- <existing-room-id>')
  console.log(`Room: ${room.name} (${room.joinCode})`)
  console.log(`Owner recovery key (store privately): ${issueOwnerKey(room.id)}`)
} finally { db.close() }
