import { ciscoForwardingPath, forwardingEntry, routedPorts } from './cisco-forwarding.js'
import { findRoute } from './topology.js'
import { calculateSubnet, ipv4ToInt } from '../server/lib/subnet.js'
import { isBridge, isLayer3, resolvedPorts, portsFor } from './devices.js'
import { networkRoute, linkAllows, aclDecision, addressMatches, ciscoRoute } from './network.js'

export const protocols = ['ARP', 'ICMP', 'TCP', 'UDP', 'HTTP']
const routers = new Set(['router', 'firewall', 'internet'])
export const simulationMac = node => {
  if (node.data?.mac) return node.data.mac.toLowerCase().replaceAll('-', ':')
  let hash = 2166136261
  for (const char of node.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return `02:00:${[24, 16, 8, 0].map(shift => ((hash >>> shift) & 255).toString(16).padStart(2, '0')).join(':')}`
}
export function simulationRoute(topology, source, target) {
  if (topology.nodes.every(n => !n.data?.model && !n.data?.ports?.length) && topology.edges.every(e => !e.sourcePort && !e.targetPort)) {
    const allowed = new Set(topology.nodes.filter(n => [source, target].includes(n.id) || isBridge(n) || routers.has(n.type)).map(n => n.id))
    return findRoute({ nodes: topology.nodes.filter(n => allowed.has(n.id)), edges: topology.edges.filter(e => allowed.has(e.sourceNodeId) && allowed.has(e.targetNodeId)) }, source, target)
  }
  return networkRoute(topology, source, target, { layer2: true }) || networkRoute(topology, source, target)
}
const fields = object => Object.entries(object).filter(([, value]) => value !== undefined && value !== null).map(([name, value]) => ({ name, value: String(value) }))
function layers(node, protocol, action, frame, strict = false) {
  return [
    { layer: 7, name: 'Application', text: protocol === 'HTTP' ? 'HTTP GET / and simulated 200 OK response from an enabled HTTP service.' : protocol === 'TCP' || protocol === 'UDP' ? strict ? 'Generated test payload; an explicitly configured listening service is required.' : 'Generated test payload; configured listening ports are checked, otherwise service availability is inferred.' : 'Simple PDU diagnostic.' },
    { layer: 6, name: 'Presentation', text: 'No encryption or encoding transformation modeled.' },
    { layer: 5, name: 'Session', text: 'User-created simulation scenario.' },
    { layer: 4, name: 'Transport', text: ['TCP', 'HTTP'].includes(protocol) ? `TCP ${frame.flags || ''}; destination port ${frame.destinationPort}.` : protocol === 'UDP' ? `UDP datagram to port ${frame.destinationPort}; no delivery acknowledgment.` : 'Not used by ARP/ICMP.' },
    { layer: 3, name: 'Network', text: protocol === 'ARP' ? 'ARP resolves the next-hop IPv4 address; it does not cross a router.' : isLayer3(node) ? `IPv4 forwarding model; TTL ${frame.ttl}.` : isBridge(node) ? 'Transparent bridge forwards the frame without changing IP TTL.' : `${frame.sourceIp} → ${frame.destinationIp}; TTL ${frame.ttl}.` },
    { layer: 2, name: 'Data Link', text: `${frame.sourceMac} → ${frame.destinationMac}${node.data?.vlan ? ` · modeled VLAN ${node.data.vlan}` : ''}. ${action}.` },
    { layer: 1, name: 'Physical', text: 'Logical topology link; timings and serialization are simulated.' },
  ]
}
function headerFields(frame) {
  return fields({ Ethernet: frame.protocol === 'ARP' ? '0x0806 (ARP)' : '0x0800 (IPv4)', 'Source MAC': frame.sourceMac, 'Destination MAC': frame.destinationMac, 'Egress port': frame.egressPort, 'Next-hop IPv4': frame.nextHopIp, VLAN: frame.vlan, 'MAC origin': frame.syntheticMac ? 'Generated locally for simulation (not observed)' : 'Configured in topology', 'Source IPv4': frame.sourceIp, 'Destination IPv4': frame.destinationIp, Protocol: frame.protocol, Operation: frame.operation, TTL: frame.protocol === 'ARP' ? undefined : frame.ttl, 'Source port': frame.sourcePort, 'Destination port': frame.destinationPort, Flags: frame.flags, Sequence: frame.sequence, Acknowledgment: frame.ack, 'Payload bytes': frame.payloadBytes })
}

export function buildPdu(topology, options, { id = 'pdu-1', cache = new Set(), startTime = 0, forwarding = 'legacy' } = {}) {
  const strict = forwarding === 'cisco'
  const destination = topology.nodes.find(n => n.id === options.target)
  topology = { ...topology, nodes: topology.nodes.map(n => {
    if (n.id !== options.source || (!strict && !n.data?.cisco) || !isLayer3(n)) return n
    const route = strict ? forwardingEntry({...topology,edges:resolvedPorts(topology)},n,destination?.data?.ipv4) : ciscoRoute(n,destination?.data?.ipv4), port = route && (strict ? routedPorts(n) : portsFor(n)).find(p => p.id === route.port)
    return port?.ipv4 ? { ...n, data:{...n.data,ipv4:port.ipv4,cidr:port.cidr ?? 24} } : n
  }) }
  const legacy = topology.nodes.every(n => !n.data?.model && !n.data?.ports?.length) && topology.edges.every(e => !e.sourcePort && !e.targetPort)
  const legacyTopology = topology
  topology = { ...topology, edges: resolvedPorts(topology) }
  const nodes = new Map(topology.nodes.map(n => [n.id, n])), source = nodes.get(options.source), target = nodes.get(options.target)
  const protocol = options.protocol || 'ICMP', ttl = Number(options.ttl ?? 64), destinationPort = Number(options.destinationPort ?? (['TCP', 'HTTP'].includes(protocol) ? 80 : 53)), payloadBytes = Number(options.payloadBytes ?? 32)
  const events = [], updatedCache = new Set(cache)
  let eventLimit = false
  const add = (from, to, action, frame, extra = {}) => {
    if (events.length >= 6000) { eventLimit = true; return null }
    const edgeId = extra.edgeId
    const event = { id: `${id}:e${events.length}`, pduId: id, time: Math.round((startTime + (events.length + 1) * .02) * 1000) / 1000, protocol: frame.protocol, fromId: from.id, toId: to.id, from: from.label, to: to.label, action, inbound: action === 'Created' ? [] : headerFields(frame), outbound: headerFields(extra.outboundFrame || frame), layers: layers(to, frame.protocol, action, extra.outboundFrame || frame, strict), frame: { ...frame }, route: { nodeIds: edgeId ? [from.id, to.id] : [to.id], edgeIds: edgeId ? [edgeId] : [] }, ...extra }
    events.push(event); return event
  }
  const failed = (node, reason, frame = { protocol, sourceIp: source?.data?.ipv4 || 'Unconfigured', destinationIp: target?.data?.ipv4 || 'Unconfigured' }) => {
    const at = node || { id: options.source || 'unknown', label: 'Unconfigured source', type: 'pc', data: {} }
    add(at, at, 'Dropped', frame, { reason, terminal: 'failed' })
    return { id, engine:strict ? 'cisco-ipv4':'legacy', protocol, source: source?.label || '', target: target?.label || '', options: { ...options }, events, cache: updatedCache, outcome: 'failed', reason }
  }
  if (!source || !target || source.id === target.id) return failed(source, 'Choose two different existing devices.')
  if (!protocols.includes(protocol) || !Number.isInteger(ttl) || ttl < 1 || ttl > 255 || !Number.isInteger(destinationPort) || destinationPort < 1 || destinationPort > 65535 || !Number.isInteger(payloadBytes) || payloadBytes < 0 || payloadBytes > 1400) return failed(source, 'Invalid protocol, TTL, port or payload size.')
  const route = strict ? ciscoForwardingPath(topology,source.id,target.id) : simulationRoute(legacy ? legacyTopology : topology, source.id, target.id)
  if (strict && route.error && !route.edgeIds.length) return failed(nodes.get(route.at),route.error)
  if (!route) return failed(source, 'No active topology path: check ports, VLAN / trunk membership, endpoint status, or end host transit.')
  for (const node of [source, target]) {
    const n = calculateSubnet(node.data?.ipv4, node.data?.cidr)
    if (!n) return failed(node, 'Configure IPv4 and CIDR on both endpoints first.')
    if (Number(node.data.cidr) < 31 && [n.networkAddress, n.broadcastAddress].includes(node.data.ipv4)) return failed(node, 'An endpoint uses the network/broadcast address.')
  }
  if (source.data.ipv4 === target.data.ipv4) return failed(source, 'Duplicate endpoint IPv4 address.')
  const networkFor = node => calculateSubnet(node.data.ipv4, node.data.cidr)
  const sameSubnet = networkFor(source).networkAddress === networkFor(target).networkAddress && Number(source.data.cidr) === Number(target.data.cidr)
  const routesAt = node => isLayer3(node) && (node.type !== 'switch' || !sameSubnet || Number(source.data.vlan || 1) !== Number(target.data.vlan || 1))
  const viaRouter = route.nodeIds.slice(1, -1).some(v => routesAt(nodes.get(v)))
  if (!strict && !sameSubnet && !viaRouter) return failed(source, 'Different subnets require a router in the topology path.')
  if (!strict && source.data.vlan && target.data.vlan && String(source.data.vlan) !== String(target.data.vlan) && !viaRouter) return failed(source, 'Different endpoint VLANs need a modeled Layer 3 path.')
  if (protocol === 'ARP' && (viaRouter || strict && (route.segments.length !== 1 || route.segments[0].to !== target.id))) return failed(source, 'ARP is limited to one Layer 2 domain; select peers without a transit router.')
  if (!strict && !sameSubnet) for (const endpoint of protocol === 'UDP' ? [source] : [source, target]) {
    if (!endpoint.data.gateway) continue // Unspecified gateways retain the legacy inferred routing mode.
    const peer = route.nodeIds.map(v => nodes.get(v)).find(n => isLayer3(n) && (n.data?.ipv4 === endpoint.data.gateway || n.data?.ports?.some(p => p.ipv4 === endpoint.data.gateway)))
    if (!peer || !addressMatches(`${endpoint.data.ipv4}/${endpoint.data.cidr}`, endpoint.data.gateway) || !networkRoute(topology, endpoint.id, peer.id, { layer2: true })) return failed(endpoint, 'Configured gateway is outside the subnet or unreachable in this VLAN.')
  }
  const initial = { protocol, sourceIp: source.data.ipv4, destinationIp: target.data.ipv4, sourceMac: simulationMac(source), destinationMac: simulationMac(target), syntheticMac: !source.data.mac || !target.data.mac, ttl, payloadBytes }
  add(source, source, 'Created', initial, { note: 'PDU queued. Capture/Forward advances one event.' })

  function arpDomain(from, peer, vlan = Number(from.data?.vlan || peer.data?.vlan || 1), segment = null) {
    const key = strict ? `${from.id}:${segment?.port || ''}:${from.data.ipv4}:${peer.data.ipv4}:${vlan}` : `${from.id}:${peer.id}:${vlan}`
    if (updatedCache.has(key)) return true
    const request = { protocol: 'ARP', operation: 'Who has / Request', sourceIp: from.data?.ipv4 || 'Interface IPv4 not modeled', destinationIp: peer.data?.ipv4 || 'Interface IPv4 not modeled', sourceMac: simulationMac(from), destinationMac: 'ff:ff:ff:ff:ff:ff', syntheticMac: !from.data?.mac || Boolean(from.data?.generatedMac), payloadBytes: 28 }
    const queue = [from.id], visited = new Set([from.id])
    for (let i = 0; i < queue.length; i++) {
      const current = nodes.get(queue[i])
      for (const edge of topology.edges) {
        if (segment && ((edge.sourceNodeId === from.id && edge.sourcePort !== segment.port) || (edge.targetNodeId === from.id && edge.targetPort !== segment.port))) continue
        if (legacy ? edge.status === 'inactive' : !linkAllows(topology, edge, vlan)) continue
        const nextId = edge.sourceNodeId === current.id ? edge.targetNodeId : edge.targetNodeId === current.id ? edge.sourceNodeId : null
        const next = nodes.get(nextId)
        if (!next || next.data?.status === 'offline' || visited.has(nextId)) continue
        if (next.data?.vlan && from.data?.vlan && !isBridge(next) && next.id !== peer.id && String(next.data.vlan) !== String(from.data.vlan)) continue
        visited.add(nextId)
        add(current, next, nextId === peer.id ? 'ARP request received' : isBridge(next) ? 'Broadcast forwarded' : 'ARP ignored (not target)', request, { edgeId: edge.id, ...(nextId === peer.id ? { outbound: [], learn: { deviceId: peer.id, device: peer.label, ip: from.data?.ipv4 || 'Unconfigured', mac: simulationMac(from) } } : {}) })
        if (eventLimit) return
        if (isBridge(next)) queue.push(nextId)
      }
    }
    const domainRoute = segment || (legacy ? findRoute({ ...topology, nodes: topology.nodes.filter(n => [from.id, peer.id].includes(n.id) || isBridge(n)) }, from.id, peer.id) : networkRoute({ ...topology, nodes: topology.nodes.map(n => n.id === from.id || n.id === peer.id ? { ...n, data: { ...n.data, vlan: String(vlan) } } : n) }, from.id, peer.id, { layer2: true }))
    if (!domainRoute) return false
    const ids = [...domainRoute.nodeIds].reverse(), edges = [...domainRoute.edgeIds].reverse()
    const reply = { ...request, operation: 'Is at / Reply', sourceIp: peer.data?.ipv4 || 'Interface IPv4 not modeled', destinationIp: from.data?.ipv4 || 'Interface IPv4 not modeled', sourceMac: simulationMac(peer), destinationMac: simulationMac(from), syntheticMac: !peer.data?.mac || !from.data?.mac || Boolean(peer.data?.generatedMac || from.data?.generatedMac) }
    for (let i = 0; i < edges.length; i++) add(nodes.get(ids[i]), nodes.get(ids[i + 1]), i === edges.length - 1 ? 'ARP resolved' : 'ARP reply forwarded', reply, { edgeId: edges[i], ...(i === edges.length - 1 ? { learn: { deviceId: from.id, device: from.label, ip: peer.data?.ipv4 || 'Unconfigured', mac: simulationMac(peer) } } : {}) })
    updatedCache.add(key); updatedCache.add(strict ? `${peer.id}:${segment?.peerPort || ''}:${peer.data.ipv4}:${from.data.ipv4}:${vlan}` : `${peer.id}:${from.id}:${vlan}`)
    return true
  }
  let stopped = false
  function transmit(reverse, operation, transport = {}) {
    if (stopped) return
    const directionRoute = reverse ? (strict ? ciscoForwardingPath(topology,target.id,source.id) : simulationRoute(legacy ? legacyTopology : topology, target.id, source.id)) : route
    if (!directionRoute) { add(target, target, 'Dropped', initial, { reason: 'No valid return path through ports/VLANs.', terminal: 'failed', outbound: [] }); stopped = true; return }
    if (strict && directionRoute.error && !directionRoute.edgeIds.length) { add(nodes.get(directionRoute.at),nodes.get(directionRoute.at),'Dropped', {...initial,sourceIp:reverse ? target.data.ipv4:source.data.ipv4,destinationIp:reverse ? source.data.ipv4:target.data.ipv4,operation}, {reason:directionRoute.error,terminal:'failed',outbound:[]}); stopped=true; return }
    const ids = directionRoute.nodeIds, edges = directionRoute.edgeIds
    let sender = nodes.get(ids[0]), frame = { ...initial, protocol, operation, ...transport, sourceIp: nodes.get(ids[0]).data.ipv4, destinationIp: strict ? (reverse ? source.data.ipv4:target.data.ipv4) : nodes.get(ids.at(-1)).data.ipv4, ttl }
    for (let i = 0; i < edges.length; i++) {
      const from = nodes.get(ids[i]), to = nodes.get(ids[i + 1])
      if (eventLimit) { stopped = true; return }
      if (i === 0 || routesAt(from)) {
        sender = from
        const peerId = ids.slice(i + 1).find(v => routesAt(nodes.get(v))) || ids.at(-1)
        const peer = nodes.get(peerId)
        const link = topology.edges.find(e => e.id === edges[i]), side = link.sourceNodeId === from.id ? 'source' : 'target', other = nodes.get(ids[i + 1])
        const ownPort = portsFor(from).find(p => p.id === link[`${side}Port`]), otherPort = portsFor(other).find(p => p.id === link[`${side === 'source' ? 'target' : 'source'}Port`])
        const vlan = isLayer3(from) ? (ownPort?.mode === 'trunk' ? Number(peer.data?.vlan || 1) : otherPort?.vlan || 1) : Number(from.data?.vlan || 1)
        const segment = strict && directionRoute.segments.find(s => s.from === from.id && s.edgeIds[0] === edges[i])
        const arpSource = segment ? interfaceView(from,segment.port,segment.sourceIp,segment.vlan) : from
        const arpPeer = segment ? interfaceView(nodes.get(segment.to),segment.peerPort,segment.nextHopIp,segment.vlan) : peer
        if (arpDomain(arpSource, arpPeer, segment ? segment.vlan : vlan, segment || null) === false) { add(from, from, 'Dropped', frame, { reason: 'ARP could not resolve the next hop in this VLAN.', terminal: 'failed', outbound: [] }); stopped = true; return }
        frame = { ...frame, sourceMac: simulationMac(arpSource), destinationMac: simulationMac(arpPeer), syntheticMac: !sender.data?.mac || !peer.data?.mac || Boolean(arpSource.data?.generatedMac || arpPeer.data?.generatedMac), ...(segment ? {egressPort:segment.port,nextHopIp:segment.nextHopIp,vlan:segment.vlan}: {}) }
      }
      const inbound = { ...frame }
      const outboundBlocked = aclDecision(from, frame)
      if (outboundBlocked) { add(from, from, 'Blocked', inbound, { reason: outboundBlocked, terminal: 'failed', outbound: [] }); stopped = true; return }
      const blocked = aclDecision(to, frame)
      if (blocked) { add(from, to, 'Blocked', inbound, { edgeId: edges[i], reason: blocked, terminal: 'failed', outbound: [] }); stopped = true; return }
      if (i === edges.length - 1 && !reverse && ['TCP', 'UDP', 'HTTP'].includes(protocol)) {
        const services = to.data?.services
        const listening = strict && !services ? false : protocol === 'HTTP' ? destinationPort === 80 && (services ? services.http : to.type === 'server') : !services || (protocol === 'TCP' && services.http && destinationPort === 80) || ((protocol === 'TCP' ? services.tcpPorts : services.udpPorts) || []).includes(destinationPort)
        if (!listening) { add(from, to, 'Dropped', inbound, { edgeId: edges[i], reason: `${to.label}: ${protocol} service on port ${destinationPort} is closed.`, terminal: 'failed', outbound: [] }); stopped = true; return }
      }
      if (routesAt(to) && i < edges.length - 1) {
        frame.ttl--
        if (frame.ttl <= 0) {
          add(from, to, 'Dropped', inbound, { edgeId: edges[i], reason: 'TTL expired at transit router. ICMP Time Exceeded generation is not modeled.', terminal: 'failed', outbound: [] })
          stopped = true; return
        }
        const outboundPeer = nodes.get(ids.slice(i + 2).find(v => routesAt(nodes.get(v))) || ids.at(-1))
        frame.sourceMac = simulationMac(to); frame.destinationMac = simulationMac(outboundPeer)
        if (strict) { const nextSegment=directionRoute.segments.find(s => s.from === to.id); if(nextSegment) { frame.sourceMac=simulationMac(interfaceView(to,nextSegment.port,nextSegment.sourceIp,nextSegment.vlan)); frame.destinationMac=simulationMac(interfaceView(nodes.get(nextSegment.to),nextSegment.peerPort,nextSegment.nextHopIp,nextSegment.vlan)); frame.egressPort=nextSegment.port; frame.nextHopIp=nextSegment.nextHopIp; frame.vlan=nextSegment.vlan; } }
        frame.syntheticMac = !to.data?.mac || !outboundPeer.data?.mac
      }
      add(from, to, i === edges.length - 1 ? 'Received' : routesAt(to) ? 'IPv4 forwarded' : 'Frame forwarded', inbound, { edgeId: edges[i], outboundFrame: { ...frame }, ...(i === edges.length - 1 ? { outbound: [] } : {}) })
    }
    if (strict && directionRoute.error) { const at=nodes.get(directionRoute.at); add(at,at,'Dropped',frame,{reason:directionRoute.error,terminal:'failed',outbound:[]}); stopped=true }
  }
  if (protocol === 'ARP') {
    const segment=strict && route.segments[0], from=segment ? interfaceView(source,segment.port,segment.sourceIp,segment.vlan) : source, peer=segment ? interfaceView(target,segment.peerPort,segment.nextHopIp,segment.vlan) : target
    updatedCache.delete(strict ? `${source.id}:${segment?.port || ''}:${from.data.ipv4}:${peer.data.ipv4}:${segment?.vlan || 1}` : `${source.id}:${target.id}:${Number(source.data?.vlan || 1)}`)
    if(arpDomain(from,peer,segment ? segment.vlan : undefined,segment || null) === false) stopped=true
  }
  else if (protocol === 'ICMP') { transmit(false, 'Echo Request (type 8)'); transmit(true, 'Echo Reply (type 0)') }
  else if (protocol === 'TCP' || protocol === 'HTTP') {
    const client = 49152, server = destinationPort
    transmit(false, 'TCP handshake', { flags: 'SYN', sourcePort: client, destinationPort: server, sequence: 1000, ack: 0, payloadBytes: 0 })
    transmit(true, 'TCP handshake', { flags: 'SYN, ACK', sourcePort: server, destinationPort: client, sequence: 5000, ack: 1001, payloadBytes: 0 })
    transmit(false, 'TCP handshake', { flags: 'ACK', sourcePort: client, destinationPort: server, sequence: 1001, ack: 5001, payloadBytes: 0 })
    transmit(false, protocol === 'HTTP' ? 'HTTP GET /' : 'TCP data', { flags: 'PSH, ACK', sourcePort: client, destinationPort: server, sequence: 1001, ack: 5001 })
    transmit(true, 'TCP data acknowledgment', { flags: 'ACK', sourcePort: server, destinationPort: client, sequence: 5001, ack: 1001 + payloadBytes, payloadBytes: 0 })
    if (protocol === 'HTTP') transmit(true, 'HTTP 200 OK', { flags: 'PSH, ACK', sourcePort: server, destinationPort: client, sequence: 5001, ack: 1001 + payloadBytes })
  } else transmit(false, 'UDP datagram', { sourcePort: 49152, destinationPort })
  if (eventLimit) { stopped = true; Object.assign(events.at(-1), { action: 'Dropped', reason: 'Scenario exceeded 6000 events. Use a smaller topology.', terminal: 'failed', outbound: [] }) }
  if (!stopped) events.at(-1).terminal = 'success'
  return { id, protocol, source: source.label, target: target.label, options: { ...options }, events, cache: updatedCache, outcome: stopped ? 'failed' : 'success', reason: stopped ? events.at(-1).reason : '', routed: viaRouter, engine: strict ? 'cisco-ipv4' : 'legacy', notes: strict ? 'Cisco-style IPv4: configured gateway and hop-by-hop longest-prefix routing, connected/static routes, ARP next hop, VLAN, per-interface Ethernet headers, TTL, return route, ACL and explicit services. No IOS, dynamic routing, SVI, NAT or STP emulation.' : 'Educational IPv4 model: ports, access/trunk VLANs, gateway, ordered stateless ACLs and configured services. Unconfigured gateways and TCP/UDP services are inferred. Dynamic routing, NAT, STP and real network probes are not emulated.' }
}

export function buildCiscoPdu(topology,options,context={}) { return buildPdu(topology,options,{...context,forwarding:'cisco'}) }
function interfaceView(node,port,ip,vlan) {
  return {...node,data:{...node.data,ipv4:ip,vlan:String(vlan),mac:port === portsFor(node)[0]?.id ? simulationMac(node) : simulationMac({...node,id:`${node.id}:${port}`,data:{}}),generatedMac:port !== portsFor(node)[0]?.id || !node.data?.mac}}
}

export function pduStatus(pdu, captured) {
  const final = pdu.events.at(-1)
  return captured.has(final.id) ? final.terminal === 'success' ? 'Successful' : 'Failed' : pdu.events.some(e => captured.has(e.id)) ? 'In progress' : 'Pending'
}
