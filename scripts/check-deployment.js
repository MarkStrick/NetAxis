// Read-only post-deployment checks. Never creates rooms or sends credentials.
const [frontendValue] = process.argv.slice(2)
function origin(value) {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTPS origin without credentials or a path (HTTP allowed only for localhost).')
  return url.origin
}
async function read(url, headers) {
  const result = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!result.ok) throw new Error(`${new URL(url).pathname}: HTTP ${result.status}`)
  return result
}
try {
  if (!frontendValue) throw new Error('Usage: npm run verify:deployment -- https://your-project.vercel.app')
  const frontend = origin(frontendValue)
  const page = await read(frontend), html = await page.text()
  if (!/<title>[^<]*NETAXIS/i.test(html)) throw new Error('The URL does not serve the NETAXIS frontend.')
  if (!page.headers.get('content-security-policy')) throw new Error('Frontend Content-Security-Policy header is missing.')
  const asset = html.match(/src="(\/assets\/[^"\s]+\.js)"/)
  if (!asset) throw new Error('Built JavaScript entry is missing.')
  const js = await read(frontend + asset[1])
  if (!/(java|ecma)script/i.test(js.headers.get('content-type') || '')) throw new Error('JavaScript entry is being served with the wrong content type.')
  const api = await read(frontend + '/api/health', { Origin: frontend })
  const health = await api.json()
  if (!health.ok || health.service !== 'netaxis-topology') throw new Error('/api is not reaching the NETAXIS backend.')
  if (!/no-store/i.test(api.headers.get('cache-control') || '')) throw new Error('Private API responses must use Cache-Control: no-store.')
  if (health.deployment === 'vercel' && health.storage !== 'postgres') throw new Error('Vercel must use durable Postgres storage.')
  console.log('PASS: frontend, built JavaScript, API health, origin and response headers.')
  console.log('Next: verify room creation/join, two-browser realtime, backup/restore and a segment Probe using PRODUCTION.md.')
} catch (error) {
  console.error('Deployment check failed: ' + error.message)
  process.exitCode = 1
}
