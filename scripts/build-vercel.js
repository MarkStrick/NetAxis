import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
const root = fileURLToPath(new URL('../', import.meta.url))
const legacyOutput = path.resolve(root, '.vercel/output')
if (path.relative(root, legacyOutput) !== path.join('.vercel', 'output')) throw new Error('Unexpected build output directory')
fs.rmSync(legacyOutput, { recursive: true, force: true })
await build({ root, define: {
  'import.meta.env.VITE_API_BASE': JSON.stringify(''),
  'import.meta.env.VITE_SOCKET_ORIGIN': JSON.stringify(''),
  'import.meta.env.VITE_DEPLOYMENT_MODE': JSON.stringify('vercel'),
} })
console.log('Vercel frontend ready. Connect Neon Postgres using DATABASE_URL; API uses the same origin.')
