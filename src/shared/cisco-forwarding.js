import { isLayer3, portsFor, resolvedPorts } from './devices.js'
import { addressMatches, networkRoute } from './network.js'

// Physical routed interfaces only; SVI/subinterfaces need their own configuration model.
export function routedPorts(node) {
  return portsFor(node).map((p,i) => ({...p,ipv4:p.ipv4 === undefined && i === 0 ? node.data?.ipv4 || '' : p.ipv4 || '',cidr:p.ipv4 === undefined && i === 0 ? node.data?.cidr ?? 24 : p.cidr ?? 24}))
}
export function forwardingEntry(topology,node,ip) {
  const ports = routedPorts(node)
  const up = port => port?.status !== 'down' && topology.edges.some(e => e.status !== 'inactive' && (e.sourceNodeId === node.id && e.sourcePort === port?.id || e.targetNodeId === node.id && e.targetPort === port?.id) && topology.nodes.find(n => n.id === (e.sourceNodeId === node.id ? e.targetNodeId : e.sourceNodeId))?.data?.status !== 'offline')
  return [...ports.filter(p => p.ipv4 && up(p)).map(p => ({network:p.ipv4,prefix:p.cidr,nextHop:'',port:p.id})),...(node.data?.cisco?.routes || []).filter(r => r.nextHop)]
    .filter(r => addressMatches(`${r.network}/${r.prefix}`,ip) && up(ports.find(p => p.id === r.port)))
    .sort((a,b) => b.prefix-a.prefix || Number(Boolean(a.nextHop))-Number(Boolean(b.nextHop)))[0] || null
}
export function ciscoForwardingPath(graph,sourceId,targetId) {
  const topology = {...graph,edges:resolvedPorts(graph)}, nodes = new Map(topology.nodes.map(n => [n.id,n]))
  const source = nodes.get(sourceId), target = nodes.get(targetId), destinationIp = target?.data?.ipv4
  const result = {nodeIds:[sourceId],edgeIds:[],segments:[]}, seen = new Set()
  const fail = (node,reason) => ({...result,error:`${node?.label || 'Device'}: ${reason}`,at:node?.id})
  if (!source || !target || !destinationIp) return fail(source,'Configure IPv4 on both endpoints first.')
  let current = source
  while (current.id !== targetId) {
    if (seen.has(current.id)) return fail(current,'Routing loop detected; check static routes.')
    seen.add(current.id)
    if (current.data?.status === 'offline') return fail(current,'Device is offline.')
    let entry, own
    if (isLayer3(current) && current.data?.cisco?.ipRouting !== false && (current.type !== 'switch' || current.data?.cisco?.ipRouting)) {
      entry = forwardingEntry(topology,current,destinationIp)
      if (!entry) return fail(current,'No route to destination; configure a connected interface or static/default route.')
      own = routedPorts(current).find(p => p.id === entry.port)
    } else {
      if (current.id !== sourceId || isLayer3(current)) return fail(current,'IP routing is disabled.')
      own = routedPorts(current).find(p => p.ipv4 === source.data?.ipv4 && p.status !== 'down')
      if (!own) return fail(current,'Source interface has no IPv4 or is administratively down.')
      const local = addressMatches(`${own.ipv4}/${own.cidr}`,destinationIp)
      if (!local && !current.data?.gateway) return fail(current,'Missing default gateway for a remote subnet.')
      entry = {port:own.id,nextHop:local ? '' : current.data.gateway}
    }
    const nextIp = entry.nextHop || destinationIp
    if (!own?.ipv4 || !addressMatches(`${own.ipv4}/${own.cidr}`,nextIp)) return fail(current,'Next-hop gateway is outside the outgoing interface subnet.')
    let segment
    for (const peer of topology.nodes) {
      if (peer.data?.status === 'offline' || peer.id === current.id) continue
      for (const peerPort of routedPorts(peer).filter(p => p.ipv4 === nextIp && p.status !== 'down')) {
        const vlan = Number(own.vlan || 1)
        const restricted = {...topology,nodes:topology.nodes.map(n => n.id === current.id || n.id === peer.id ? {...n,data:{...n.data,vlan:String(vlan)}} : n),edges:topology.edges.filter(e => (e.sourceNodeId !== current.id || e.sourcePort === own.id) && (e.targetNodeId !== current.id || e.targetPort === own.id) && (e.sourceNodeId !== peer.id || e.sourcePort === peerPort.id) && (e.targetNodeId !== peer.id || e.targetPort === peerPort.id))}
        const path = networkRoute(restricted,current.id,peer.id,{layer2:true})
        if (path) { segment={...path,from:current.id,to:peer.id,sourceIp:own.ipv4,nextHopIp:nextIp,port:own.id,peerPort:peerPort.id,vlan}; break }
      }
      if (segment) break
    }
    if (!segment) return fail(current,'ARP cannot resolve next hop through the configured port/VLAN.')
    result.segments.push(segment); result.nodeIds.push(...segment.nodeIds.slice(1)); result.edgeIds.push(...segment.edgeIds)
    current = nodes.get(segment.to)
    if (current.id !== targetId && !isLayer3(current)) return fail(current,'Configured gateway is not a Layer 3 device.')
  }
  return result
}
