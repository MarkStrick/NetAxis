export const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

export function findRoute(topology, sourceId, targetId) {
  const nodes = new Map(topology.nodes.map((node) => [node.id, node]))
  if (!nodes.has(sourceId) || !nodes.has(targetId) || sourceId === targetId || nodes.get(sourceId).data?.status === 'offline' || nodes.get(targetId).data?.status === 'offline') return null
  const adjacent = new Map()
  for (const edge of topology.edges) {
    if (edge.status === 'inactive') continue
    for (const [from, to] of [[edge.sourceNodeId, edge.targetNodeId], [edge.targetNodeId, edge.sourceNodeId]]) {
      if (!nodes.has(to) || nodes.get(to).data?.status === 'offline') continue
      if (!adjacent.has(from)) adjacent.set(from, [])
      adjacent.get(from).push({ nodeId: to, edgeId: edge.id })
    }
  }
  const previous = new Map([[sourceId, null]]), queue = [sourceId]
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    if (current === targetId) break
    for (const step of adjacent.get(current) || []) {
      if (previous.has(step.nodeId)) continue
      previous.set(step.nodeId, { nodeId: current, edgeId: step.edgeId })
      queue.push(step.nodeId)
    }
  }
  if (!previous.has(targetId)) return null
  const nodeIds = [], edgeIds = []
  for (let current = targetId; current;) {
    nodeIds.unshift(current)
    const step = previous.get(current)
    if (!step) break
    edgeIds.unshift(step.edgeId); current = step.nodeId
  }
  return { nodeIds, edgeIds }
}

export function csvCell(value) {
  let text = String(value ?? '')
  // Neutralize spreadsheet formulas while preserving quoted commas/newlines.
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
