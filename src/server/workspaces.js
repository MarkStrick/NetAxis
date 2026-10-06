import { nanoid } from 'nanoid'
import { db, getTopology, replaceTopology, bumpRevision } from './db.js'

export { parseWorkspace } from './lib/workspace-schema.js'
import { parseWorkspace } from './lib/workspace-schema.js'

export function exportWorkspace(roomId) {
  const topology = getTopology(roomId)
  const plan = db.prepare('SELECT input_json FROM ip_plans WHERE room_id = ?').get(roomId)
  // An allowlist keeps session/recovery keys, room codes and probe credentials out of files.
  return { ...parseWorkspace({ format: 'netaxis-workspace', version: 1,
    room: { name: topology.room.name, description: topology.room.description, accessMode: topology.room.accessMode },
    nodes: topology.nodes, edges: topology.edges, plan: plan ? JSON.parse(plan.input_json) : null, template: topology.template,
  }), exportedAt: new Date().toISOString() }
}

// Caller wraps room, membership, graph, plan and scenarios in a single transaction.
export function installWorkspace(roomId, workspace, actorId) {
  const nodeIds = new Map(workspace.nodes.map(n => [n.id, `node_${nanoid(12)}`]))
  const edgeIds = new Map(workspace.edges.map(e => [e.id, `edge_${nanoid(12)}`]))
  const nodes = workspace.nodes.map(n => ({ ...n, id: nodeIds.get(n.id) }))
  const edges = workspace.edges.map(e => ({ ...e, id: edgeIds.get(e.id), sourceNodeId: nodeIds.get(e.sourceNodeId), targetNodeId: nodeIds.get(e.targetNodeId) }))
  replaceTopology(roomId, nodes, edges, actorId)
  bumpRevision(roomId)
  if (workspace.plan) db.prepare('INSERT INTO ip_plans (room_id,revision,input_json,updated_at) VALUES (?,?,?,?)').run(roomId, 1, JSON.stringify(workspace.plan), new Date().toISOString())
  if (workspace.template) {
    const info = { ...workspace.template, scenarios: workspace.template.scenarios.map(s => ({ ...s,
      source: nodeIds.get(s.source) || s.source, target: nodeIds.get(s.target) || s.target,
      disabledEdges: s.disabledEdges.map(id => edgeIds.get(id) || id), enabledEdges: s.enabledEdges.map(id => edgeIds.get(id) || id),
    })) }
    db.prepare('INSERT INTO room_templates (room_id,info_json) VALUES (?,?)').run(roomId, JSON.stringify(info))
  }
}
