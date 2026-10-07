<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps({ state: Object, participant: Object, send: Function, connectionState: String })
const joined = ref(false), busy = ref(false), muted = ref(false), error = ref(''), peerStates = ref({})
const members = computed(() => props.state?.voice || [])
let stream, heartbeat, generation = 0, processing = Promise.resolve(), disposed = false
const peers = new Map(), seen = new Set()
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
try { if (import.meta.env.VITE_RTC_ICE_SERVERS) iceServers = JSON.parse(import.meta.env.VITE_RTC_ICE_SERVERS) } catch { /* fallback to STUN */ }
function removePeer(id) { const peer = peers.get(id); if (!peer) return; peer.pc.close(); peer.audio.pause(); peer.audio.srcObject = null; peers.delete(id); delete peerStates.value[id] }
function cleanup() { generation++; joined.value = false; busy.value = false; clearInterval(heartbeat); stream?.getTracks().forEach(t => t.stop()); stream = null; for (const id of peers.keys()) removePeer(id); seen.clear() }
async function leave() { const wasJoined = joined.value; cleanup(); if (wasJoined) await props.send({ action: 'voice-leave' }).catch(() => {}) }
async function join() {
  if (busy.value || joined.value) return
  busy.value = true; error.value = ''; const run = ++generation
  try {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) throw new Error('Voice ต้องใช้ HTTPS หรือ localhost และเบราว์เซอร์ที่รองรับ WebRTC')
    const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    if (disposed || generation !== run) { media.getTracks().forEach(t => t.stop()); return }
    stream = media; muted.value = false
    await props.send({ action: 'voice-join' })
    if (disposed || generation !== run) { cleanup(); return }
    joined.value = true
    heartbeat = setInterval(() => props.send({ action: 'voice-heartbeat' }).catch(failure => { error.value = failure.message; cleanup() }), 10000)
    await reconcile(props.state)
  } catch (failure) { error.value = failure.name === 'NotAllowedError' ? 'ไม่ได้รับสิทธิ์ไมโครโฟน กรุณาอนุญาตแล้วเข้าร่วมอีกครั้ง' : failure.message; cleanup() }
  finally { busy.value = false }
}
function toggleMute() { muted.value = !muted.value; stream?.getAudioTracks().forEach(t => { t.enabled = !muted.value }) }
function peerFor(id) {
  if (peers.has(id)) return peers.get(id)
  const pc = new RTCPeerConnection({ iceServers }), audio = new Audio(), peer = { pc, audio, candidates: [] }
  audio.autoplay = true; peers.set(id, peer); peerStates.value[id] = 'connecting'
  stream.getTracks().forEach(t => pc.addTrack(t, stream))
  pc.onicecandidate = event => { if (event.candidate && joined.value) props.send({ action: 'voice-signal', target: id, kind: 'candidate', candidate: event.candidate.toJSON() }).catch(f => { error.value = f.message }) }
  pc.ontrack = event => { audio.srcObject = event.streams[0]; audio.play().catch(() => { error.value = 'กดเปิดเสียงเพื่ออนุญาตการเล่นเสียง' }) }
  pc.onconnectionstatechange = () => { peerStates.value[id] = pc.connectionState; if (pc.connectionState === 'failed') error.value = 'เชื่อมต่อเสียงไม่ได้ เครือข่ายนี้อาจต้องตั้งค่า TURN server' }
  return peer
}
async function reconcile(state) {
  if (!joined.value || !state) return
  const run = generation, ids = new Set(state.voice.filter(m => m.id !== props.participant.id).map(m => m.id))
  for (const id of peers.keys()) if (!ids.has(id)) removePeer(id)
  for (const id of ids) if (!peers.has(id)) {
    const { pc } = peerFor(id)
    // One deterministic initiator avoids simultaneous offers from both browsers.
    if (props.participant.id < id) { await pc.setLocalDescription(await pc.createOffer()); if (run !== generation) return; await props.send({ action: 'voice-signal', target: id, kind: 'offer', sdp: pc.localDescription.sdp }) }
  }
  for (const signal of state.signals || []) {
    if (run !== generation || seen.has(signal.id) || !ids.has(signal.from)) continue
    seen.add(signal.id); const peer = peerFor(signal.from), pc = peer.pc
    if (signal.kind === 'candidate') { if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate); else peer.candidates.push(signal.candidate); continue }
    await pc.setRemoteDescription({ type: signal.kind, sdp: signal.sdp })
    for (const candidate of peer.candidates.splice(0)) await pc.addIceCandidate(candidate)
    if (signal.kind === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); if (run !== generation) return; await props.send({ action: 'voice-signal', target: signal.from, kind: 'answer', sdp: pc.localDescription.sdp }) }
  }
}
watch(() => props.state, state => { processing = processing.then(() => reconcile(state)).catch(failure => { if (joined.value) error.value = failure.message }) })
async function enableAudio() { for (const p of peers.values()) await p.audio.play().catch(() => {}); error.value = '' }
onBeforeUnmount(() => { disposed = true; leave() })
</script>
<template>
  <section class="voice-controls" aria-label="Room voice chat"><strong>Voice · {{ members.length }}/8 คน</strong><p>พูดคุยเสียงในห้องระหว่างออกแบบ Network</p><button v-if="!joined" class="secondary-action compact" :disabled="busy || connectionState !== 'connected'" @click="join">{{ busy ? 'กำลังเปิดไมค์…' : 'เข้าร่วม Voice' }}</button><template v-else><button class="secondary-action compact" :aria-pressed="muted" @click="toggleMute">{{ muted ? 'เปิดไมค์' : 'ปิดไมค์' }}</button><button class="quiet-button" @click="leave">ออกจาก Voice</button></template><p v-if="members.length">{{ members.map(m => m.displayName + (m.id === participant.id ? ' (คุณ)' : peerStates[m.id] ? ' · ' + peerStates[m.id] : '')).join(', ') }}</p><p v-if="error" role="alert" class="inline-error">{{ error }} <button v-if="joined" class="quiet-button" @click="enableAudio">เปิดเสียง</button></p>
  </section>
</template>
