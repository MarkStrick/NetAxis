import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { contains, privateCidr } from '../src/server/lib/planning.js'

const windows = process.platform === 'win32'
export function command(file, args, timeout = 10_000) {
  return new Promise(resolve => execFile(file, args, { windowsHide: true, shell: false, timeout, maxBuffer: 128 * 1024, encoding: 'utf8' }, (error, stdout = '', stderr = '') => resolve({ ok: !error, output: stdout.slice(0, 32_000), error: error ? (error.code === 'ENOENT' ? `${file} is not installed` : error.killed ? `${file} timed out` : stderr.slice(0, 1000) || error.message.slice(0, 1000)) : '', missing: error?.code === 'ENOENT' })))
}
export async function neighbors() {
  const result = windows
    ? await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-NetNeighbor -AddressFamily IPv4 -ErrorAction Stop | Select-Object IPAddress,LinkLayerAddress,@{Name='State';Expression={[string]$_.State}} | ConvertTo-Json -Compress"], 15_000)
    : await command('ip', ['-j', 'neigh', 'show'])
  if (!result.ok) throw new Error(result.error)
  const parsed = result.output.trim() ? JSON.parse(result.output.replace(/^\uFEFF/, '')) : []
  return (Array.isArray(parsed) ? parsed : [parsed]).map(row => ({ ip: row.IPAddress || row.dst, mac: (row.LinkLayerAddress || row.lladdr || '').replaceAll('-', ':').toLowerCase(), active: (Array.isArray(row.state) ? row.state : [row.State || row.state]).some(v => String(v).toLowerCase() === 'reachable') }))
    .filter(row => /^([a-f0-9]{2}:){5}[a-f0-9]{2}$/.test(row.mac) && !['00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff'].includes(row.mac))
}
export async function ping(address) {
  const started = Date.now()
  const result = await command('ping', windows ? ['-n', '1', '-w', '1000', address] : ['-n', '-c', '1', '-W', '1', address], 3500)
  if (result.missing) throw new Error(result.error)
  const reachable = result.ok && /ttl[=:\s]/i.test(result.output)
  const match = result.output.match(/time[=<]\s*([\d.]+)\s*ms/i)
  return { ip: address, reachable, latencyMs: reachable && match ? Number(match[1]) : null, durationMs: Date.now() - started }
}
export async function runProbeJob(job) {
  if (!privateCidr(job.network) || !Array.isArray(job.targets) || job.targets.length > 256 || job.targets.some(ip => !contains(job.network, ip))) throw new Error('Job exceeds the enrolled private subnet')
  if (job.kind === 'netstat') {
    const result = await command(windows ? 'netstat' : 'ss', windows ? ['-ano'] : ['-tunap'], 15_000)
    return { observations: [], output: result.output, error: result.error }
  }
  if (job.kind === 'traceroute') {
    if (job.targets.length !== 1) throw new Error('Traceroute requires one target')
    const result = await command(windows ? 'tracert' : 'traceroute', windows ? ['-d', '-h', '12', '-w', '800', job.targets[0]] : ['-n', '-m', '12', '-w', '1', job.targets[0]], 45_000)
    return { observations: [], output: result.output, error: result.error }
  }
  if (!['scan', 'host', 'neighbor'].includes(job.kind)) throw new Error('Unsupported job type')
  const rows = new Array(job.targets.length)
  let next = 0
  if (job.kind !== 'neighbor') await Promise.all(Array.from({ length: Math.min(8, job.targets.length) }, async () => {
    while (next < job.targets.length) { const index = next++; const { durationMs, ...row } = await ping(job.targets[index]); rows[index] = row }
  }))
  else job.targets.forEach((ip, index) => { rows[index] = { ip, reachable: false, latencyMs: null } })
  let cache = [], warning = ''
  try { cache = await neighbors() } catch (error) {
    if (job.kind === 'neighbor') throw error
    warning = `Neighbor collection unavailable: ${error.message}. MAC verification unavailable.`
  }
  return { observations: rows.map(row => {
    const neighbor = cache.find(n => n.ip === row.ip)
    return { ...row, probed: job.kind !== 'neighbor', mac: neighbor?.mac || '', neighborActive: neighbor?.active || false }
  }), output: warning, error: '' }
}

async function main() {
  if (!['win32', 'linux'].includes(process.platform)) throw new Error('Probe supports Windows and Linux')
  const server = process.env.NETAXIS_SERVER, probeId = process.env.NETAXIS_PROBE_ID, token = process.env.NETAXIS_PROBE_TOKEN
  if (!server || !probeId || !token) throw new Error('Set NETAXIS_SERVER, NETAXIS_PROBE_ID and NETAXIS_PROBE_TOKEN in a private .env.probe file')
  const url = new URL(server)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Probe server must use HTTPS (HTTP is allowed only for local development)')
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('NETAXIS_SERVER must be an origin, such as https://netaxis.example.com')
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(probeId)) throw new Error('Invalid probe ID')
  const enrolledNetwork = process.env.NETAXIS_PROBE_NETWORK
  if (!privateCidr(enrolledNetwork)) throw new Error('Set NETAXIS_PROBE_NETWORK to the enrolled RFC1918 subnet')
  let stopping = false
  process.on('SIGINT', () => { stopping = true }); process.on('SIGTERM', () => { stopping = true })
  const request = async (suffix, body) => {
    const response = await fetch(`${url.origin}/api/probes/${probeId}/jobs${suffix}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000), ...(body ? { body: JSON.stringify(body) } : {}) })
    if (response.status === 401) { stopping = true; throw new Error('Probe access revoked; enroll again') }
    if (!response.ok) throw new Error(`Server returned ${response.status}`)
    return response.json()
  }
  console.log(`NETAXIS Probe started for ${enrolledNetwork}; waiting for on-demand jobs`)
  do {
    try {
      const { job } = await request('')
      if (job) {
        let result
        try {
          if (job.network !== enrolledNetwork) throw new Error('Server network differs from local enrollment configuration')
          result = await runProbeJob(job)
        } catch (error) { result = { observations: [], output: '', error: error.message } }
        let reported = false
        for (let attempt = 0; attempt < 3 && !reported && !stopping; attempt++) {
          try { await request(`/${job.id}/result`, { ...result, lease: job.lease }); reported = true }
          catch (error) { if (attempt === 2 || stopping) throw error; await new Promise(resolve => setTimeout(resolve, 1000)) }
        }
        console.log(`${job.kind}: ${result.error ? 'failed' : 'reported'} (${job.targets.length} targets)`)
      }
    } catch (error) { console.error(error.message) }
    if (process.argv.includes('--once') || stopping) break
    await new Promise(resolve => setTimeout(resolve, 5000))
  } while (!stopping)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
