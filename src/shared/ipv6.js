export function parseIpv6(address) {
  if (typeof address !== 'string' || !address || address.includes('%') || address.includes('/')) return null
  let text = address.toLowerCase()
  if (text.includes('.')) {
    const last = text.slice(text.lastIndexOf(':') + 1), octets = last.split('.')
    if (octets.length !== 4 || octets.some(v => !/^(0|[1-9]\d{0,2})$/.test(v) || Number(v) > 255)) return null
    text = text.slice(0, text.lastIndexOf(':') + 1) + ((Number(octets[0]) << 8) | Number(octets[1])).toString(16) + ':' + ((Number(octets[2]) << 8) | Number(octets[3])).toString(16)
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (halves.length === 1 && left.length !== 8 || halves.length === 2 && missing < 1) return null
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...right]
  if (groups.length !== 8 || groups.some(g => !/^[a-f\d]{1,4}$/.test(g))) return null
  return groups.reduce((value, group) => value * 65536n + BigInt(parseInt(group, 16)), 0n)
}
export function formatIpv6(value) {
  const groups = Array.from({ length: 8 }, (_, i) => Number(value >> BigInt((7 - i) * 16) & 65535n).toString(16))
  let best = -1, length = 1
  for (let i = 0; i < groups.length;) {
    if (groups[i] !== '0') { i++; continue }
    let end = i; while (end < 8 && groups[end] === '0') end++
    if (end - i > length) { best = i; length = end - i }; i = end
  }
  return best < 0 ? groups.join(':') : `${groups.slice(0, best).join(':')}::${groups.slice(best + length).join(':')}`
}
export function calculateIpv6(input) {
  if (typeof input !== 'string') return null
  const [address, prefixText, ...rest] = input.trim().split('/'), value = parseIpv6(address)
  if (value === null || rest.length || !/^(0|[1-9]\d{0,2})$/.test(prefixText || '')) return null
  const prefix = Number(prefixText)
  if (prefix > 128) return null
  const size = 1n << BigInt(128 - prefix), start = value / size * size
  return { network: `${formatIpv6(start)}/${prefix}`, prefix, first: formatIpv6(start), last: formatIpv6(start + size - 1n), addresses: size.toString(), start, size }
}
export function planIpv6(parent, childPrefix = 64, count = 1) {
  const network = calculateIpv6(parent)
  if (!network || !Number.isInteger(childPrefix) || childPrefix < network.prefix || childPrefix > 128 || !Number.isInteger(count) || count < 1 || count > 100) throw new Error('ระบุ IPv6/prefix ที่ถูกต้อง และจำนวน Subnet 1–100')
  const size = 1n << BigInt(128 - childPrefix)
  if (size * BigInt(count) > network.size) throw new Error('Parent network มีพื้นที่ไม่พอสำหรับจำนวน Subnet นี้')
  return { network: network.network, capacity: (network.size / size).toString(), addressesPerSubnet: size.toString(), subnets: Array.from({ length: count }, (_, i) => {
    const start = network.start + BigInt(i) * size
    return { cidr: `${formatIpv6(start)}/${childPrefix}`, first: formatIpv6(start), last: formatIpv6(start + size - 1n), gateway: formatIpv6(size > 1n ? start + 1n : start) }
  }) }
}
