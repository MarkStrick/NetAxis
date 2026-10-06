import { nanoid } from 'nanoid'
import { db, replaceTopology, bumpRevision } from './db.js'
import { nodeSchema, edgeSchema, parseOrThrow } from './lib/validation.js'
import { planSchema, calculatePlan } from './lib/planning.js'
import { instantiateTemplate } from '../shared/templates.js'

export function installTemplate(roomId, preset, actorId) {
  const data = instantiateTemplate(preset, nanoid(12))
  const nodes = data.nodes.map(n => parseOrThrow(nodeSchema, n)), edges = data.edges.map(e => parseOrThrow(edgeSchema, e))
  const plan = parseOrThrow(planSchema, data.plan)
  const design = calculatePlan(plan)
  if (design.issues.length) throw new Error('Reference template plan failed validation')
  replaceTopology(roomId, nodes, edges, actorId)
  bumpRevision(roomId)
  db.prepare('INSERT INTO ip_plans (room_id,revision,input_json,updated_at) VALUES (?,?,?,?)').run(roomId, 1, JSON.stringify(plan), new Date().toISOString())
  db.prepare('INSERT INTO room_templates (room_id,info_json) VALUES (?,?)').run(roomId, JSON.stringify(data.info))
}
