export function ipv4ToInt(ip) {
  if (typeof ip !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(ip.trim())) return null
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

export function intToIpv4(value) {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

export function calculateSubnet(ip, cidr) {
  if (cidr === '' || cidr === null || cidr === undefined) return null
  const address = ipv4ToInt(ip)
  const prefix = Number(cidr)
  if (address === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (address & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const hostCount = prefix >= 31 ? Math.max(0, broadcast - network + 1) : Math.max(0, broadcast - network - 1)
  return {
    input: `${ip}/${prefix}`,
    networkAddress: intToIpv4(network),
    broadcastAddress: intToIpv4(broadcast),
    subnetMask: intToIpv4(mask),
    firstUsable: prefix >= 31 ? intToIpv4(network) : intToIpv4(network + 1),
    lastUsable: prefix >= 31 ? intToIpv4(broadcast) : intToIpv4(broadcast - 1),
    hostCount,
  }
}
