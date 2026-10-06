// Shared playback uses a server clock anchor. Every browser rebuilds the same
// deterministic PDU and derives its cursor without streaming animation frames.
export const playbackPosition = (state, now = Date.now()) => Math.min(state?.eventCount || 0,
  (state?.position || 0) + (state?.status === 'running' ? Math.max(0, now - state.anchor) / 700 * state.speed : 0))
export const roomPlayback = (state, topologyRevision, now = Date.now()) => {
  if (!state) return null
  if (state.topologyRevision !== topologyRevision) return { ...state, status: 'stopped', request: null, eventCount: 0, position: 0, serverTime: now }
  const position = playbackPosition(state, now)
  return { ...state, position, anchor: now, status: state.status === 'running' && position >= state.eventCount ? 'completed' : state.status, serverTime: now }
}
