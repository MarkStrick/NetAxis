import fs from 'node:fs'
import path from 'node:path'
import { db } from '../src/server/db.js'

const destination = path.resolve(process.env.BACKUP_DIR || 'backups')
fs.mkdirSync(destination, { recursive: true })
const filename = path.join(destination, `netaxis-${new Date().toISOString().replaceAll(':', '-')}.sqlite`)
try {
  await db.backup(filename)
  fs.chmodSync(filename, 0o600)
  console.log(`Backup created: ${filename}`)
} finally { db.close() }
