import { z } from 'zod'
import { nanoid } from 'nanoid'
import { parseOrThrow } from './validation.js'
import { buildPdu } from '../../shared/simulator.js'
import { scenarioTopology } from '../../shared/templates.js'
import { playbackPosition, roomPlayback } from '../../shared/room-simulation.js'

const requestSchema = z.object({ source: z.string().min(1).max(80), target: z.string().min(1).max(80), protocol: z.enum(['ARP', 'ICMP', 'TCP', 'UDP', 'HTTP']), ttl: z.number().int().min(1).max(255), destinationPort: z.number().int().min(1).max(65535), payloadBytes: z.number().int().min(0).max(1400), scenarioId: z.string().max(80).optional() })
const actionSchema = z.object({ revision: z.number().int().nonnegative(), topologyRevision: z.number().int().nonnegative(), action: z.enum(['run', 'pause', 'resume', 'stop', 'forward', 'back', 'replay', 'speed']), request: requestSchema.optional(), speed: z.union([z.literal(.5), z.literal(1), z.literal(2), z.literal(4)]).optional(), autoplay: z.boolean().default(true) })
function reject(statusCode, message, code = 'SIMULATION_CONFLICT') { throw Object.assign(new Error(message), { statusCode, code }) }
export function changeRoomSimulation(topology, previous, member, raw, now = Date.now()) {
  const input = parseOrThrow(actionSchema, raw)
  if (!['owner', 'editor'].includes(member.role)) reject(403, 'Viewer ดู Simulator ร่วมกันได้ แต่ควบคุมไม่ได้', 'PERMISSION_DENIED')
  if (input.revision !== (previous?.revision || 0) || input.topologyRevision !== topology.room.revision) reject(409, 'Simulator หรือ topology เปลี่ยนแล้ว กรุณารอ sync แล้วลองใหม่')
  const current = roomPlayback(previous, topology.room.revision, now)
  if (current?.request && ['running', 'paused'].includes(current.status) && current.controller.id !== member.id && member.role !== 'owner') reject(403, `Simulator กำลังควบคุมโดย ${current.controller.displayName}`, 'SIMULATION_CONTROLLER')
  const state = { ...current, revision: input.revision + 1, topologyRevision: topology.room.revision, anchor: now, position: playbackPosition(current, now), speed: current?.speed || 1 }
  delete state.serverTime
  if (input.action === 'run') {
    if (!input.request) reject(400, 'เลือก PDU หรือ scenario ก่อน Run', 'VALIDATION_ERROR')
    let request = input.request, scenario
    if (request.scenarioId) {
      scenario = topology.template?.scenarios.find(s => s.id === request.scenarioId)
      if (!scenario) reject(400, 'Scenario ไม่อยู่ในห้องนี้', 'VALIDATION_ERROR')
      request = { ...scenario, scenarioId: scenario.id }
    }
    if (request.source === request.target || ![request.source, request.target].every(id => topology.nodes.some(n => n.id === id))) reject(400, 'Source/Destination ต้องเป็นอุปกรณ์คนละตัวในห้องนี้', 'VALIDATION_ERROR')
    if (scenario && [...(scenario.disabledEdges || []), ...(scenario.enabledEdges || [])].some(id => !topology.edges.some(e => e.id === id))) reject(400, 'สายของ Scenario ถูกลบแล้ว', 'VALIDATION_ERROR')
    const pdu = buildPdu(scenario ? scenarioTopology(topology, scenario) : topology, request)
    if (pdu.events.length > 6000) reject(400, 'Scenario ใหญ่เกิน 6000 events', 'VALIDATION_ERROR')
    Object.assign(state, { runId: nanoid(16), request, eventCount: pdu.events.length, position: 0, status: input.autoplay ? 'running' : 'paused', controller: { id: member.id, displayName: member.displayName } })
  } else if (input.action === 'stop') {
    Object.assign(state, { request: null, eventCount: 0, position: 0, status: 'stopped' })
  } else {
    if (!current?.request) reject(409, 'ไม่มี simulation ที่กำลังแชร์อยู่')
    if (input.action === 'pause') state.status = 'paused'
    if (input.action === 'resume') state.status = state.position < state.eventCount ? 'running' : 'completed'
    if (input.action === 'forward') { state.status = 'paused'; state.position = Math.min(state.eventCount, Math.floor(state.position) + 1) }
    if (input.action === 'back') { state.status = 'paused'; state.position = Math.max(0, Math.floor(state.position) - 1) }
    if (input.action === 'replay') { state.status = 'paused'; state.position = 0 }
    if (input.action === 'speed') { if (!input.speed) reject(400, 'Missing speed', 'VALIDATION_ERROR'); state.speed = input.speed }
  }
  return state
}
