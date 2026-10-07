// Generic lab models: specifications are simulation presets, not vendor hardware claims.
export const deviceModels = [
  { id: 'router-4', type: 'router', name: 'Lab Router · 4 × Gigabit', layer: 3, count: 4, prefix: 'G0/' },
  { id: 'router-8', type: 'router', name: 'Lab Router · 8 × Gigabit', layer: 3, count: 8, prefix: 'G0/' },
  { id: 'switch-24', type: 'switch', name: 'Lab Switch · 24 ports · L2', layer: 2, count: 24, prefix: 'G0/' },
  { id: 'switch-48', type: 'switch', name: 'Lab Switch · 48 ports · L2', layer: 2, count: 48, prefix: 'G0/' },
  { id: 'switch-l3', type: 'switch', name: 'Lab Multilayer Switch · 24 ports', layer: 3, count: 24, prefix: 'G0/' },
  { id: 'firewall-4', type: 'firewall', name: 'Lab Firewall · 4 ports', layer: 3, count: 4, prefix: 'G0/' },
  { id: 'firewall-8', type: 'firewall', name: 'Lab Firewall · 8 ports', layer: 3, count: 8, prefix: 'G0/' },
  { id: 'server-4', type: 'server', name: 'Lab Server · 4 × Ethernet', layer: 2, count: 4, prefix: 'Eth' },
  ...['pc', 'server', 'printer', 'access-point', 'internet', 'generic'].map(type => ({ id: `${type}-default`, type, name: `Lab ${type}`, layer: ['internet'].includes(type) ? 3 : 2, count: type === 'generic' || type === 'internet' ? 8 : type === 'access-point' ? 4 : 1, prefix: 'Eth' })),
]
export const modelFor = node => deviceModels.find(m => m.id === node.data?.model && m.type === node.type) || deviceModels.find(m => m.type === node.type)
export const isLayer3 = node => modelFor(node)?.layer === 3
export function portsFor(node) {
  const model = modelFor(node)
  return Array.from({ length: model?.count || 1 }, (_, index) => {
    const id = `${model?.prefix || 'Eth'}${index}`
    return { id, status: 'up', mode: 'access', vlan: Number(node.data?.vlan || 1), allowedVlans: [1], ...(node.data?.ports || []).find(p => p.id === id) }
  })
}
// Legacy links receive deterministic ports so old projects remain editable.
export function resolvedPorts(topology) {
  const used = new Map(topology.nodes.map(n => [n.id, new Set()]))
  for (const e of topology.edges) for (const side of ['source', 'target']) if (e[`${side}Port`]) used.get(e[`${side}NodeId`])?.add(e[`${side}Port`])
  return topology.edges.map(edge => {
    const result = { ...edge }
    for (const side of ['source', 'target']) {
      const node = topology.nodes.find(n => n.id === edge[`${side}NodeId`]), taken = used.get(node?.id)
      if (!result[`${side}Port`] && node && taken) {
        const port = portsFor(node).find(p => !taken.has(p.id))
        if (port) { result[`${side}Port`] = port.id; taken.add(port.id) }
      }
    }
    return result
  })
}
export function portIssues(topology) {
  const issues = [], occupied = new Set()
  for (const edge of resolvedPorts(topology)) for (const side of ['source', 'target']) {
    const node = topology.nodes.find(n => n.id === edge[`${side}NodeId`]), id = edge[`${side}Port`]
    const key = `${node?.id}:${id}`
    if (!node || !portsFor(node).some(p => p.id === id)) issues.push({ nodeId: node?.id, edgeId: edge.id, message: `${node?.label || 'Missing device'}: port ${id || '(capacity exceeded)'} does not exist` })
    else if (occupied.has(key)) issues.push({ nodeId: node.id, edgeId: edge.id, message: `${node.label}: ${id} is already connected` })
    occupied.add(key)
  }
  return issues
}
export function assertPortTopology(topology) {
  // Existing files without hardware specifications remain importable.
  const issues = portIssues(topology).filter(i => topology.nodes.find(n => n.id === i.nodeId)?.data?.model || topology.edges.find(e => e.id === i.edgeId)?.sourcePort || topology.edges.find(e => e.id === i.edgeId)?.targetPort)
  if (issues.length) throw Object.assign(new Error(issues[0].message), { statusCode: 400, code: 'INVALID_PORT' })
}
export const vlanColor = vlan => `hsl(${(Number(vlan || 1) * 67) % 360} 70% 55%)`
