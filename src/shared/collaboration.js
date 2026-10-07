import { z } from 'zod'
const candidateSchema = z.object({ candidate: z.string().max(4000), sdpMid: z.string().max(100).nullable().optional(), sdpMLineIndex: z.number().int().min(0).max(100).nullable().optional(), usernameFragment: z.string().max(256).nullable().optional() })
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('move'), nodeId: z.string().max(80), position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }), revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal('voice-join') }), z.object({ action: z.literal('voice-heartbeat') }), z.object({ action: z.literal('voice-leave') }),
  z.object({ action: z.literal('voice-signal'), target: z.string().max(80), kind: z.enum(['offer', 'answer', 'candidate']), sdp: z.string().max(16000).optional(), candidate: candidateSchema.optional() }),
])
export function collaborationSnapshot(state, memberId, after = 0, now = Date.now()) {
  return { moves: (state?.moves || []).filter(m => m.expiresAt > now), voice: (state?.voice || []).filter(m => m.expiresAt > now), signals: (state?.signals || []).filter(s => s.target === memberId && s.id > after && s.expiresAt > now), cursor: state?.sequence || 0 }
}
export function changeCollaboration(previous, member, raw, topology, now = Date.now()) {
  const input = commandSchema.safeParse(raw)
  const reject = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode, code: 'COLLABORATION_ERROR' }) }
  if (!input.success) reject(400, 'Invalid collaboration command')
  const value = input.data, snapshot = collaborationSnapshot(previous, member.id, 0, now)
  const state = { moves: snapshot.moves, voice: snapshot.voice, signals: (previous?.signals || []).filter(s => s.expiresAt > now), sequence: previous?.sequence || 0, rates: { ...previous?.rates } }
  const rate = state.rates[member.id]?.start > now - 10000 ? { ...state.rates[member.id] } : { start: now, count: 0 }
  if (++rate.count > 100) reject(429, 'Too many collaboration commands')
  state.rates[member.id] = rate
  for (const [id, r] of Object.entries(state.rates)) if (r.start < now - 10000) delete state.rates[id]
  if (value.action === 'move') {
    if (!['owner', 'editor'].includes(member.role)) reject(403, 'Viewer cannot move devices')
    if (value.revision !== topology.room.revision || !topology.nodes.some(n => n.id === value.nodeId)) reject(409, 'Topology changed; refresh before moving')
    state.moves = state.moves.filter(m => m.nodeId !== value.nodeId && m.participantId !== member.id)
    state.moves.push({ nodeId: value.nodeId, position: value.position, participantId: member.id, displayName: member.displayName, revision: value.revision, expiresAt: now + 2000 })
  } else if (value.action === 'voice-join' || value.action === 'voice-heartbeat') {
    if (value.action === 'voice-heartbeat' && !state.voice.some(m => m.id === member.id)) reject(409, 'Join voice first')
    if (!state.voice.some(m => m.id === member.id) && state.voice.length >= 8) reject(400, 'Voice room supports up to 8 participants')
    state.voice = state.voice.filter(m => m.id !== member.id)
    state.voice.push({ id: member.id, displayName: member.displayName, expiresAt: now + 30000 })
  } else if (value.action === 'voice-leave') {
    state.voice = state.voice.filter(m => m.id !== member.id)
    state.signals = state.signals.filter(s => s.from !== member.id && s.target !== member.id)
  } else {
    if (value.target === member.id || ![value.target, member.id].every(id => state.voice.some(m => m.id === id))) reject(403, 'Voice signaling requires both members to join this room')
    if (value.kind !== 'candidate' && !value.sdp || value.kind === 'candidate' && !value.candidate) reject(400, 'Missing voice signal payload')
    state.signals.push({ id: ++state.sequence, from: member.id, ...value, expiresAt: now + 30000 })
    state.signals = state.signals.slice(-500)
  }
  return state
}
