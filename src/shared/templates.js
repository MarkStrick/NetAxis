import labs from './lab-templates.json' with { type: 'json' }
export const presetProjects = labs

export function instantiateTemplate(template, suffix) {
  const ids = new Map(template.nodes.map(n => [n.id, `${n.id}-${suffix}`]))
  return {
    nodes: template.nodes.map(n => ({ ...n, id: ids.get(n.id), position: { ...n.position }, data: JSON.parse(JSON.stringify(n.data)) })),
    edges: template.edges.map(e => ({ ...e, id: `${e.id}-${suffix}`, sourceNodeId: ids.get(e.sourceNodeId), targetNodeId: ids.get(e.targetNodeId) })),
    plan: JSON.parse(JSON.stringify(template.plan)),
    info: { id: template.id, name: template.name, useCase: template.useCase, checklist: [...template.checklist], mode: 'Realtime', scenarios: template.scenarios.map(s => ({ ...s, source: ids.get(s.source), target: ids.get(s.target), disabledEdges: (s.disabledEdges || []).map(id => `${id}-${suffix}`), enabledEdges: (s.enabledEdges || []).map(id => `${id}-${suffix}`) })) },
  }
}

export function scenarioTopology(topology, scenario) {
  const disabled = new Set(scenario.disabledEdges || []), enabled = new Set(scenario.enabledEdges || [])
  return { ...topology, edges: topology.edges.map(e => disabled.has(e.id) ? {...e,status:'inactive'} : enabled.has(e.id) ? {...e,status:'active'} : e) }
}


export function templateBounds(preset) {
  const nodes = preset?.nodes || []
  const x = Math.min(0, ...nodes.map(n => n.position.x)) - 48
  const y = Math.min(0, ...nodes.map(n => n.position.y)) - 48
  const right = Math.max(1, ...nodes.map(n => n.position.x + 144)) + 48
  const bottom = Math.max(1, ...nodes.map(n => n.position.y + 68)) + 48
  return { x, y, width: right - x, height: bottom - y }
}
export const templateViewBox = preset => Object.values(templateBounds(preset)).join(' ')
