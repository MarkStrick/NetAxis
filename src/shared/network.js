import { isLayer3, portsFor, resolvedPorts, portIssues } from './devices.js'
import { calculateSubnet, ipv4ToInt } from '../server/lib/subnet.js'

export function linkAllows(topology, edge, vlan) {
  if (edge.status === 'inactive') return false
  return ['source', 'target'].every(side => {
    const node = topology.nodes.find(n => n.id === edge[`${side}NodeId`])
    if (!node || node.data?.status === 'offline') return false
    const port = portsFor(node).find(p => p.id === edge[`${side}Port`])
    if (!port || port.status === 'down') return false
    // Router access interfaces terminate their attached VLAN. Trunks remain explicit.
    return port.mode === 'trunk' ? port.allowedVlans.includes(Number(vlan)) : isLayer3(node) && !node.data?.model && !(node.data?.ports || []).some(p => p.id === port.id) ? true : Number(port.vlan) === Number(vlan)
  })
}
export function networkRoute(topology, sourceId, targetId, { layer2 = false } = {}) {
  const nodes = new Map(topology.nodes.map(n => [n.id, n])), source = nodes.get(sourceId), target = nodes.get(targetId)
  if (!source || !target || sourceId === targetId || source.data?.status === 'offline' || target.data?.status === 'offline') return null
  const edges = resolvedPorts(topology), queue = [{ id: sourceId, vlan: Number(source.data?.vlan || 1), nodeIds: [sourceId], edgeIds: [] }], visited = new Set(), discovered = new Set([`${sourceId}:${Number(source.data?.vlan || 1)}`])
  for (let i = 0; i < queue.length; i++) {
    const state = queue[i], node = nodes.get(state.id), key = `${state.id}:${state.vlan}`
    if (visited.has(key)) continue
    visited.add(key)
    if (state.id === targetId && (isLayer3(target) || state.vlan === Number(target.data?.vlan || 1))) return { nodeIds: state.nodeIds, edgeIds: state.edgeIds }
    if (state.id !== sourceId && !['switch', 'access-point', 'generic'].includes(node.type) && (!isLayer3(node) || layer2)) continue
    for (const edge of edges) {
      const nextId = edge.sourceNodeId === state.id ? edge.targetNodeId : edge.targetNodeId === state.id ? edge.sourceNodeId : null
      if (!nextId || state.nodeIds.includes(nextId)) continue
      const otherSide = edge.sourceNodeId === state.id ? 'target' : 'source'
      const other = nodes.get(nextId), otherPort = other && portsFor(other).find(p => p.id === edge[`${otherSide}Port`])
      const ownSide = otherSide === 'target' ? 'source' : 'target'
      const ownPort = portsFor(node).find(p => p.id === edge[`${ownSide}Port`])
      const vlans = !layer2 && isLayer3(node) ? ownPort?.mode === 'trunk' ? ownPort.allowedVlans : [isLayer3(other) ? ownPort?.vlan || state.vlan : otherPort?.vlan || 1] : [state.vlan]
      for (const vlan of vlans) if (!discovered.has(`${nextId}:${vlan}`) && linkAllows(topology, edge, vlan)) { discovered.add(`${nextId}:${vlan}`); queue.push({ id: nextId, vlan, nodeIds: [...state.nodeIds, nextId], edgeIds: [...state.edgeIds, edge.id] }) }
    }
  }
  return null
}
export function addressMatches(pattern, ip) {
  if (!pattern || pattern === 'any') return true
  const [address, prefix = '32', ...rest] = pattern.split('/')
  if (rest.length || !/^(0|[1-9]\d?)$/.test(prefix)) return false
  const subnet = calculateSubnet(address, prefix), value = ipv4ToInt(ip)
  return Boolean(subnet && value !== null && value >= ipv4ToInt(subnet.networkAddress) && value <= ipv4ToInt(subnet.broadcastAddress))
}
export function aclDecision(node, frame) {
  if (frame.protocol === 'ARP') return null
  const rule = (node.data?.acl || []).find(r => (r.protocol === 'ANY' || r.protocol === frame.protocol || r.protocol === 'TCP' && frame.protocol === 'HTTP' || r.protocol === 'HTTP' && ['HTTP', 'TCP'].includes(frame.protocol) && [frame.sourcePort, frame.destinationPort].includes(80)) && (!r.port || Number(r.port) === frame.destinationPort) && addressMatches(r.source, frame.sourceIp) && addressMatches(r.destination, frame.destinationIp))
  const action = rule?.action || node.data?.aclDefault || 'allow'
  return action === 'deny' ? `ACL blocked ${frame.protocol}${frame.destinationPort ? ` port ${frame.destinationPort}` : ''} at ${node.label}${rule ? ` (rule ${(node.data.acl || []).indexOf(rule) + 1})` : ' (default deny)'}` : null
}
export function validateNetwork(topology) {
  const issues = portIssues(topology).map(i => ({ ...i, severity: 'error' })), ips = new Set()
  const add = (node, message, severity = 'error') => issues.push({ nodeId: node.id, message: `${node.label}: ${message}`, severity })
  for (const node of topology.nodes) {
    if (node.data?.ipv4) {
      const subnet = calculateSubnet(node.data.ipv4, node.data.cidr)
      if (!subnet) add(node, 'invalid IPv4/prefix')
      else if (Number(node.data.cidr) < 31 && [subnet.networkAddress, subnet.broadcastAddress].includes(node.data.ipv4)) add(node, 'network/broadcast address cannot be assigned to a host')
      if (ips.has(node.data.ipv4)) add(node, 'duplicate IPv4 address')
      ips.add(node.data.ipv4)
      if (node.data.gateway && (!addressMatches(`${node.data.ipv4}/${node.data.cidr}`, node.data.gateway) || !topology.nodes.some(n => isLayer3(n) && (n.data.ipv4 === node.data.gateway || n.data.ports?.some(p => p.ipv4 === node.data.gateway)) && networkRoute(topology, node.id, n.id, { layer2: true })))) add(node, 'gateway is outside the subnet or not reachable in this VLAN')
    } else if (['pc', 'server'].includes(node.type)) add(node, 'configure an IP address before simulation', 'warning')
    if (!topology.edges.some(e => e.sourceNodeId === node.id || e.targetNodeId === node.id)) add(node, 'no connections', 'warning')
  }
  for (const edge of resolvedPorts(topology)) {
    if (edge.status === 'inactive') continue
    const a = topology.nodes.find(n => n.id === edge.sourceNodeId), b = topology.nodes.find(n => n.id === edge.targetNodeId)
    const ap = a && portsFor(a).find(p => p.id === edge.sourcePort), bp = b && portsFor(b).find(p => p.id === edge.targetPort)
    if (ap && bp && !Array.from(new Set([ap.vlan, bp.vlan, ...ap.allowedVlans, ...bp.allowedVlans])).some(v => linkAllows(topology, edge, v))) issues.push({ edgeId: edge.id, severity: 'error', message: `${a.label} ${ap.id} ↔ ${b.label} ${bp.id}: VLAN mismatch or port down` })
  }
  return issues
}
