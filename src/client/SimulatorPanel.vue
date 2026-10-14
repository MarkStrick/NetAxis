<script setup>
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { buildCiscoPdu as buildPdu, pduStatus, protocols } from './lib/simulator.js'
import { scenarioTopology } from '../shared/templates.js'
import { playbackPosition } from '../shared/room-simulation.js'
const props = defineProps({ topology: { type: Object, required: true }, resetKey: Number, topologyRevision: Number, scenarios: { type: Array, default: () => [] }, initialMode: { type: String, default: 'Simulation' }, shared: Boolean, roomPlayback: Object, participant: Object, commandBusy: Boolean })
const emit = defineEmits(['close', 'packets', 'picking', 'share-mode', 'room-command'])
const sharedLocked = computed(() => props.shared && (props.commandBusy || !['owner', 'editor'].includes(props.participant?.role) || (props.roomPlayback?.request && (props.roomPlayback.status === 'paused' || playing.value) && props.roomPlayback.controller?.id !== props.participant?.id && props.participant?.role !== 'owner')))
function failureSummary(reason='') {
  const labels=[['Missing default gateway','ยังไม่ได้ตั้งค่า Gateway สำหรับไปอีกเครือข่าย'],['No route','Router ไม่มีเส้นทางไปปลายทาง'],['outside','Gateway อยู่นอก Subnet ของพอร์ตที่ใช้'],['ARP','หาอุปกรณ์ next hop ไม่พบ ตรวจสายและ VLAN'],['ACL blocked','Packet ถูกบล็อกด้วยกฎ ACL'],['TTL expired','Packet หมด TTL ก่อนถึงปลายทาง'],['closed','ยังไม่ได้เปิด Service / Port ที่ปลายทาง'],['IP routing is disabled','ยังไม่ได้เปิด IP routing บนอุปกรณ์นี้'],['Routing loop','เส้นทางวนกลับ ตรวจ Static Route']]
  return labels.find(([key]) => reason.includes(key))?.[1] || reason
}
const resultLabel = status => ({Successful:'สำเร็จ',Failed:'ไม่สำเร็จ',Pending:'รอเริ่ม', 'In progress':'กำลังทดสอบ'})[status] || status
function roomCommand(action, extra = {}) { if (sharedLocked.value) return; if (['run','resume','forward'].includes(action)) unlockSound(); else stopTone(); emit('room-command', { action, ...extra }) }
const mode = ref(props.initialMode), source = ref(props.topology.nodes[0]?.id || ''), target = ref(props.topology.nodes[1]?.id || '')
const protocol = ref('ICMP'), ttl = ref(64), port = ref(80), payload = ref(32), speed = ref(1)
const pdus = ref([]), events = ref([]), cursor = ref(0), selectedId = ref(''), detailTab = ref('OSI Model'), filters = ref([...protocols]), playing = ref(false), message = ref(''), picking = ref('')
const eventList = ref(null)
const scenarioId = ref(props.scenarios[0]?.id || '')
const setupTab = ref(props.scenarios.length ? 'scenario' : 'custom')
const activeScenario = computed(() => props.scenarios.find(s => s.id === scenarioId.value))
const scenarioReady = computed(() => activeScenario.value && [activeScenario.value.source, activeScenario.value.target].every(id => props.topology.nodes.some(n => n.id === id)) && [...(activeScenario.value.disabledEdges || []), ...(activeScenario.value.enabledEdges || [])].every(id => props.topology.edges.some(e => e.id === id)))
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false
let cache = new Set(), sequence = 0, frame = null, progress = 0, lastTime = 0, playbackGeneration = 0
const captured = computed(() => new Set(events.value.slice(0, cursor.value).map(e => e.id)))
const visibleEvents = computed(() => events.value.slice(0, cursor.value).filter(e => filters.value.includes(e.protocol)))
const selected = computed(() => events.value.find(e => e.id === selectedId.value))
const remaining = computed(() => cursor.value < events.value.length)
const stats = computed(() => ({ success: pdus.value.filter(p => pduStatus(p, captured.value) === 'Successful').length, failed: pdus.value.filter(p => pduStatus(p, captured.value) === 'Failed').length }))
const arpTable = computed(() => {
  const table = new Map()
  for (const e of events.value.slice(0, cursor.value)) if (e.learn) table.set(`${e.learn.deviceId}:${e.learn.ip}`, e.learn)
  return [...table.values()]
})
// Audio starts only from a user action; incoming room playback cannot bypass autoplay policy.
const soundOn = ref(true), soundNotice = ref('');
try { soundOn.value = localStorage.getItem('netaxis-scenario-sound') !== 'off' } catch {}
let audioContext = null, tone = null, lastChime = -Infinity;
function stopTone() { if (tone) { try { tone.stop() } catch {} tone = null } }
function unlockSound() {
  if (!soundOn.value) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) { soundNotice.value = 'เบราว์เซอร์นี้ไม่รองรับเสียง · Scenario ยังรันได้ตามปกติ'; return }
    audioContext ||= new Audio();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => { soundNotice.value = 'เปิดเสียงไม่ได้ ลองกดปุ่มเสียงอีกครั้ง'; });
    soundNotice.value = '';
  } catch { soundNotice.value = 'เปิดเสียงไม่ได้ · Scenario ยังรันได้ตามปกติ' }
}
function chime() {
  if (!soundOn.value || audioContext?.state !== 'running') return;
  const now = audioContext.currentTime;
  if (now - lastChime < .12) return;
  try {
    stopTone();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(1046.5, now);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.045, now + .008); gain.gain.exponentialRampToValueAtTime(.0001, now + .1);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (tone === oscillator) tone = null };
    tone = oscillator; lastChime = now; oscillator.start(now); oscillator.stop(now + .11);
  } catch { soundNotice.value = 'เล่นเสียงไม่ได้ · Scenario ยังรันได้ตามปกติ' }
}
function toggleSound() {
  soundOn.value = !soundOn.value; soundNotice.value = '';
  try { localStorage.setItem('netaxis-scenario-sound', soundOn.value ? 'on' : 'off') } catch {}
  if (soundOn.value) { unlockSound(); if (audioContext?.state === 'running') chime() } else stopTone();
}
function marker(event, value = 1) { emit('packets', event ? [{ id: event.id, eventId: event.id, protocol: event.protocol, operation: event.frame?.operation || event.action, route: event.route, edgeIndex: 0, progress: Math.max(0, Math.min(1, value)), active: true, failed: event.terminal === 'failed' }] : []) }
function pause(silence = true) { if (silence) stopTone(); playing.value = false; playbackGeneration++; if (frame !== null) cancelAnimationFrame(frame); frame = null }
function stopPicking() { picking.value = ''; emit('picking', { phase: '', source: '' }) }
function reset() {
  pause(); stopPicking(); pdus.value = []; events.value = []; cursor.value = 0; selectedId.value = ''; cache = new Set(); progress = 0; message.value = ''; marker(null)
}
function stopPlayback() { if (props.shared) { roomCommand('stop'); return } reset(); message.value = 'หยุดแล้ว · ล้างคิว PDU และ packet เลือก scenario เพื่อเริ่มใหม่ได้' }
function closeSimulator() { pause(); stopPicking(); marker(null); emit('close') }
function replay() { if (props.shared) { roomCommand('replay'); return } pause(); stopPicking(); cursor.value = 0; selectedId.value = ''; progress = 0; message.value = 'Scenario เริ่มต้นใหม่แล้ว'; marker(null) }
function inspectEvent(id) { if (!props.shared) { pause(); progress = 0 } selectedId.value = id; if (!props.shared) marker(selected.value) }
async function capture() {
  const event = events.value[cursor.value]
  if (!event) return
  cursor.value++; selectedId.value = event.id; marker(event); chime()
  message.value = event.reason || `${event.protocol} · ${event.from} → ${event.to} · ${event.action}`
  if (event.terminal === 'success') message.value = `${event.pduId}: Successful${event.protocol === 'UDP' ? ' (ถึงปลายทางใน model; UDP ไม่มี ACK)' : ''}`
  await nextTick()
  if (eventList.value) eventList.value.scrollTop = eventList.value.scrollHeight
}
function forward() { unlockSound(); if (props.shared) { roomCommand('forward'); return } pause(); progress = 0; capture() }
function back() { if (props.shared) { roomCommand('back'); return } pause(); progress = 0; if (cursor.value > 0) cursor.value--; selectedId.value = events.value[cursor.value - 1]?.id || ''; marker(selected.value) }
function tick(now, generation) {
  if (!playing.value || generation !== playbackGeneration) return
  frame = null
  const event = events.value[cursor.value]
  if (!event) { pause(); return }
  const delta = Math.min(100, Math.max(0, now - lastTime)); lastTime = now
  progress += delta / (700 / Number(speed.value))
  marker(event, reducedMotion ? 1 : Math.min(1, progress))
  if (!playing.value || generation !== playbackGeneration) return
  if (progress >= 1) { progress = 0; capture() }
  if (!playing.value || generation !== playbackGeneration) return
  if (remaining.value) frame = requestAnimationFrame(next => tick(next, generation))
  else pause(false)
}
function autoPlay() {
  if (!playing.value) unlockSound();
  if (props.shared) { roomCommand(playing.value ? 'pause' : 'resume'); return }
  if (playing.value) { pause(); message.value = 'Paused · กด Resume เพื่อเล่นต่อ หรือ Stop / Reset เพื่อล้างคิว'; return }
  if (!remaining.value) return
  playing.value = true; lastTime = performance.now()
  const generation = ++playbackGeneration
  frame = requestAnimationFrame(now => tick(now, generation))
}
function setMode(value) { if (sharedLocked.value) return; mode.value = value; if (value === 'Realtime' && remaining.value && !playing.value) autoPlay(); else if (value === 'Simulation') { if (props.shared && playing.value) roomCommand('pause'); else pause() } }
function configureScenario() {
  const s = activeScenario.value
  if (!s) return
  source.value = s.source; target.value = s.target; protocol.value = s.protocol
  ttl.value = s.ttl ?? 64; port.value = s.destinationPort ?? 443; payload.value = s.payloadBytes ?? 32
}
function runScenario() { if (!scenarioReady.value) return; configureScenario(); queuePdu(activeScenario.value) }
function queuePdu(scenario = null) {
  if (!source.value || !target.value || source.value === target.value) { message.value = 'เลือกอุปกรณ์ต้นทางและปลายทางคนละเครื่อง'; return }
  if (props.shared) {
    roomCommand('run', { request: { source: source.value, target: target.value, protocol: protocol.value, ttl: Number(ttl.value), destinationPort: Number(port.value), payloadBytes: Number(payload.value), ...(scenario ? { scenarioId: scenario.id } : {}) }, autoplay: mode.value === 'Realtime' }); stopPicking(); return
  }
  if (playing.value || pdus.value.length >= 10) { message.value = 'Pause ก่อนเพิ่ม PDU หรือ Reset เมื่อครบ 10 PDUs'; return }
  unlockSound();
  const model = scenario ? scenarioTopology(props.topology, scenario) : props.topology
  const pdu = buildPdu(model, { source: source.value, target: target.value, protocol: protocol.value, ttl: ttl.value, destinationPort: port.value, payloadBytes: payload.value }, { id: `PDU-${sequence + 1}`, cache, startTime: events.value.at(-1)?.time || 0 })
  if (scenario) { pdu.scenarioName = scenario.name; pdu.expected = scenario.expected }
  if (events.value.length + pdu.events.length > 6000) { message.value = 'Scenario ใหญ่เกิน 6000 events กรุณา Reset หรือใช้ topology ที่เล็กลง'; return }
  sequence++; cache = pdu.cache; pdus.value.push(pdu); events.value.push(...pdu.events)
  message.value = `${pdu.id} queued · ${pdu.protocol} · ${pdu.source} → ${pdu.target}`
  stopPicking()
  if (mode.value === 'Realtime') autoPlay()
}
function simplePdu() {
  if (sharedLocked.value) return
  if (playing.value || pdus.value.length >= 10) return
  mode.value = 'Simulation'; protocol.value = 'ICMP'; picking.value = 'source'; source.value = ''; target.value = ''; message.value = 'Simple PDU: คลิกอุปกรณ์ต้นทางบน canvas แล้วคลิกปลายทาง'; emit('picking', { phase: 'source', source: '' })
}
function pickNode(id) {
  if (!props.topology.nodes.some(n => n.id === id)) return
  if (picking.value === 'source') { source.value = id; picking.value = 'target'; message.value = 'เลือกอุปกรณ์ปลายทาง'; emit('picking', { phase: 'target', source: id }) }
  else if (picking.value === 'target') { target.value = id; queuePdu() }
}
let sharedRunId = null, sharedReceivedAt = 0, sharedAnchor
function drawRoomPlayback(generation = playbackGeneration) {
  if (!props.shared || !sharedAnchor?.request || generation !== playbackGeneration) return
  const position = playbackPosition(sharedAnchor, sharedAnchor.anchor + Math.max(0, performance.now() - sharedReceivedAt))
  const nextCursor = Math.min(events.value.length, Math.floor(position))
  if (nextCursor !== cursor.value) { if (nextCursor > cursor.value && sharedAnchor.status === 'running') chime(); cursor.value = nextCursor; selectedId.value = events.value[cursor.value - 1]?.id || ''; if (eventList.value) eventList.value.scrollTop = eventList.value.scrollHeight }
  playing.value = sharedAnchor.status === 'running' && position < events.value.length
  marker(events.value[playing.value ? cursor.value : cursor.value - 1], reducedMotion ? 1 : playing.value ? position % 1 : 1)
  if (playing.value) frame = requestAnimationFrame(() => drawRoomPlayback(generation))
  else frame = null
}
function applyRoomPlayback() {
  if (!props.shared) return
  pause(); stopPicking()
  const state = props.roomPlayback
  if (!state?.request || (props.topologyRevision !== undefined && state.topologyRevision !== props.topologyRevision)) { sharedRunId = null; reset(); message.value = 'Simulator ร่วมกัน · รอผู้ควบคุมกด Run'; return }
  if (sharedRunId !== state.runId || !events.value.length) {
    reset(); sharedRunId = state.runId
    const scenario = props.scenarios.find(s => s.id === state.request.scenarioId)
    const pdu = buildPdu(scenario ? scenarioTopology(props.topology, scenario) : props.topology, state.request, { id: 'PDU-1' })
    if (scenario) { pdu.scenarioName = scenario.name; pdu.expected = scenario.expected }
    pdus.value = [pdu]; events.value = pdu.events; sequence = 1
  }
  sharedAnchor = state; sharedReceivedAt = performance.now(); speed.value = state.speed
  message.value = `Simulator ร่วมกัน · ${state.controller.displayName} · ${state.status}`
  drawRoomPlayback()
}
watch(() => [props.shared, props.roomPlayback, props.topologyRevision], () => { if (props.shared) applyRoomPlayback(); else { sharedRunId = null; reset() } }, { immediate: true })
watch(() => props.resetKey, () => { reset(); if (props.shared) applyRoomPlayback() })
watch(() => props.scenarios, () => { if (!props.scenarios.some(s => s.id === scenarioId.value)) scenarioId.value = props.scenarios[0]?.id || ''; if (!playing.value && !events.value.length) configureScenario() }, { immediate: true })
watch(() => JSON.stringify({ nodes: props.topology.nodes.map(n => [n.id, n.label, n.type, n.data]), edges: props.topology.edges.map(e => [e.id, e.sourceNodeId, e.targetNodeId, e.sourcePort, e.targetPort, e.status, e.medium]) }), () => {
  const hadEvents = events.value.length; reset()
  if (hadEvents) message.value = 'Topology/config เปลี่ยนแล้ว จึงล้าง scenario เพื่อใช้ข้อมูลปัจจุบัน'
  if (!props.topology.nodes.some(n => n.id === source.value)) source.value = props.topology.nodes[0]?.id || ''
  if (!props.topology.nodes.some(n => n.id === target.value)) target.value = props.topology.nodes.find(n => n.id !== source.value)?.id || ''
  sharedRunId = null
}, { flush: 'sync' })
onBeforeUnmount(() => { pause(); stopPicking(); marker(null); if (audioContext) audioContext.close().catch(() => {}); })
function startScenario(id) {
  if (props.shared || !props.scenarios.some(s => s.id === id)) return false
  reset(); scenarioId.value = id; setupTab.value = 'scenario'; mode.value = 'Realtime'; if (!scenarioReady.value) return false; runScenario(); return true
}
defineExpose({ startScenario, pickNode, inspectEvent, cancelPick: stopPicking, reset })
</script>

<template>
  <section class="simulation-panel packet-tracer-panel" aria-label="Network Simulator" @pointerdown.stop @pointermove.stop @pointerup.stop @click.stop @keydown.stop @wheel.stop>
    <div class="sim-control-dock">
      <header class="simulation-panel-heading"><div><p class="eyebrow">SIMULATOR</p><strong>ทดสอบเครือข่าย</strong></div><button class="panel-close" aria-label="Close Simulator" @click="closeSimulator">×</button></header>
      <div class="sim-sound-control"><button class="quiet-button" :aria-pressed="soundOn" aria-label="เสียงขณะรัน Scenario" @click="toggleSound">{{ soundOn ? 'เสียงติ๊ง: เปิด' : 'เสียงติ๊ง: ปิด' }}</button><small v-if="shared && soundOn">เสียงเป็นของเครื่องนี้ · ถ้ายังไม่ได้ยิน ให้ปิดแล้วเปิดเสียงอีกครั้ง</small></div>
      <p v-if="soundNotice" class="sim-sound-notice" role="status">{{ soundNotice }}</p>
      <div v-show="pdus.length || playing" class="sim-transport" role="group" aria-label="Playback controls"><button class="secondary-action compact sim-pause-resume" :disabled="sharedLocked || (!playing && !remaining)" :aria-pressed="playing" @click="autoPlay">{{ playing ? 'Ⅱ Pause' : '▶ Resume / Play' }}</button><button class="quiet-button sim-stop" :disabled="sharedLocked || (!pdus.length && !playing)" @click="stopPlayback">■ Stop / Reset</button><span role="status">{{ playing ? 'Running' : remaining ? 'Paused / Ready' : pdus.length ? 'Completed' : 'Idle' }}</span></div>
    </div>
    <div v-if="scenarios.length" class="sim-setup-tabs" role="group" aria-label="วิธีทดสอบ"><button :aria-pressed="setupTab === 'scenario'" @click="setupTab = 'scenario'">Scenario สำเร็จรูป</button><button :aria-pressed="setupTab === 'custom'" @click="setupTab = 'custom'">เลือกต้นทางเอง</button></div>
    <div v-if="scenarios.length" v-show="setupTab === 'scenario'" class="sim-scenarios">    <section v-if="scenarios.length" class="sim-ready-scenarios"><p class="eyebrow">SCENARIOS</p><label>Scenario<select v-model="scenarioId" aria-label="Ready scenario" :disabled="playing" @change="configureScenario"><option v-for="s in scenarios" :key="s.id" :value="s.id">{{ s.name }}</option></select></label><p class="sim-model-note">Expected {{ activeScenario?.expected === 'failed' ? 'Failed' : 'Successful' }}{{ activeScenario?.note ? ` · ${activeScenario.note}` : '' }}</p><p v-if="!scenarioReady" class="sim-drop-reason">อุปกรณ์หรือสายที่ scenario ต้องใช้ถูกลบแล้ว เลือก Source/Destination เองด้านล่าง</p><button class="primary-action compact sim-run-scenario" :disabled="sharedLocked || playing || !scenarioReady || (!shared && pdus.length >= 10)" @click="runScenario">เริ่มการทดสอบตัวอย่าง</button></section>
</div>
    <div v-show="!scenarios.length || setupTab === 'custom'" class="sim-custom-setup"><h3 class="sim-custom-heading">ทดสอบเอง</h3>
    <p class="sim-intro">เลือกต้นทาง ปลายทาง และชนิดการทดสอบ <span class="sim-engine-label">Cisco-style IPv4</span></p>
    <div class="sim-pdu-tools"><button class="secondary-action compact sim-simple-pdu" :class="{ active: picking }" :disabled="sharedLocked || playing || (!shared && pdus.length >= 10)" @click="simplePdu">เลือกต้นทาง/ปลายทางบนผัง</button><button v-if="picking" class="quiet-button" @click="stopPicking">ยกเลิกการเลือก</button></div>
    <fieldset class="simulation-fields" :disabled="sharedLocked || playing || Boolean(picking)">
      <label>ต้นทาง<select v-model="source" aria-label="PDU source"><option value="" disabled>เลือกอุปกรณ์</option><option v-for="n in topology.nodes" :key="n.id" :value="n.id">{{ n.label }}</option></select></label>
      <label>ปลายทาง<select v-model="target" aria-label="PDU destination"><option value="" disabled>เลือกอุปกรณ์</option><option v-for="n in topology.nodes" :key="n.id" :value="n.id">{{ n.label }}</option></select></label>
      <label>ชนิดการทดสอบ<select v-model="protocol" aria-label="PDU protocol" @change="port = protocol === 'UDP' ? 53 : 80"><option v-for="p in protocols" :key="p" :value="p">{{ p === 'ICMP' ? 'ICMP · Ping' : p }}</option></select></label>
      <details class="sim-advanced"><summary>รายละเอียด Packet</summary>      <label>TTL<input v-model.number="ttl" type="number" min="1" max="255" aria-label="PDU TTL" /></label>
      <label v-if="['TCP','UDP','HTTP'].includes(protocol)">Destination port<input v-model.number="port" type="number" min="1" max="65535" aria-label="PDU destination port" /></label>
      <label>Payload bytes<input v-model.number="payload" type="number" min="0" max="1400" aria-label="PDU payload bytes" /></label>
</details>
    </fieldset>
    <button class="primary-action compact sim-add-pdu" :disabled="sharedLocked || playing || Boolean(picking) || !source || !target || source === target || (!shared && pdus.length >= 10)" @click="queuePdu()">ทดสอบ {{ protocol === 'ICMP' ? 'Ping' : protocol }}</button>
    </div>
    <p v-if="playing" class="sim-setup-hint">กำลังทดสอบ · กด Pause ด้านบนเพื่อหยุดชั่วคราว</p><p v-if="!shared && pdus.length >= 10" class="sim-setup-hint">ครบ 10 การทดสอบแล้ว · กด Stop / Reset เพื่อเริ่มชุดใหม่</p>
    <section class="sim-options" aria-label="โหมดเล่นและการแชร์">      <div class="sim-audience-tabs" role="group" aria-label="Simulator audience"><button :aria-pressed="!shared" :class="{ active: !shared }" @click="emit('share-mode', false)">ส่วนตัว</button><button :aria-pressed="shared" :class="{ active: shared }" @click="emit('share-mode', true)">ร่วมกันในห้อง</button></div>
      <p v-if="shared" class="sim-model-note">แชร์ครั้งละ 1 PDU · Run ใหม่แทนรอบเดิม · ปิดแผงยังเล่นต่อในห้อง · {{ roomPlayback?.controller?.displayName || 'ยังไม่มีผู้ควบคุม' }}<span v-if="sharedLocked"> · ดูอย่างเดียว</span><span v-if="commandBusy"> · กำลังส่งคำสั่ง…</span></p>
      <div class="sim-mode-tabs" role="group" aria-label="Simulator mode"><button :class="{ active: mode === 'Realtime' }" :aria-pressed="mode === 'Realtime'" :disabled="sharedLocked" @click="setMode('Realtime')">เล่นอัตโนมัติ</button><button :class="{ active: mode === 'Simulation' }" :aria-pressed="mode === 'Simulation'" :disabled="sharedLocked" @click="setMode('Simulation')">ดูทีละขั้น</button></div>
</section>

    <p v-if="!source || !target || source === target" class="sim-setup-hint">เลือกต้นทางและปลายทางคนละเครื่องก่อนเริ่มทดสอบ</p>
    <p v-if="sharedLocked" class="permission-note">ดูการทดสอบร่วมกัน · ผู้ควบคุมเป็นสมาชิกอื่น</p>
    <p class="simulation-message" role="status">{{ message || 'เริ่มทดสอบ แล้วกด Play หรือ Capture / Forward เพื่อดูเส้นทาง' }}</p>
    <div v-for="p in pdus" :key="`result-${p.id}`" class="sim-route-result"><strong>{{ p.protocol === 'ICMP' ? 'Ping' : p.protocol }} · {{ topology.nodes.find(n => n.id === p.source)?.label || p.source }} → {{ topology.nodes.find(n => n.id === p.target)?.label || p.target }}</strong><p class="result-status" :data-outcome="pduStatus(p, captured)">{{ resultLabel(pduStatus(p, captured)) }}{{ p.reason && pduStatus(p, captured) === 'Failed' ? ': ' + failureSummary(p.reason) : '' }}</p><p>{{ [...new Set(p.events.filter(e => captured.has(e.id) && e.protocol !== 'ARP').flatMap(e => e.route.nodeIds))].map(id => topology.nodes.find(n => n.id === id)?.label).join(' → ') || 'รอ Capture / Play' }}</p></div>
    <div class="sim-event-heading"><strong>เส้นทาง Packet</strong><span>Captured {{ cursor }} / {{ events.length }} · {{ events[cursor - 1]?.time.toFixed(3) || '0.000' }} s</span></div>
    <div class="sim-event-filters" role="group" aria-label="Visible event filters"><label v-for="p in protocols" :key="p"><input v-model="filters" type="checkbox" :value="p" :aria-label="`${p} event filter`" /><span :data-protocol="p">{{ p }}</span></label><button class="quiet-button" @click="filters = [...protocols]">Show All</button><button class="quiet-button" @click="filters = []">None</button></div>
    <div ref="eventList" class="sim-event-list"><table><thead><tr><th>เวลา</th><th>จาก</th><th>ถึง</th><th>เหตุการณ์</th></tr></thead><tbody><tr v-for="e in visibleEvents" :key="e.id" :class="{ selected: selectedId === e.id, failed: e.terminal === 'failed' }"><td>{{ e.time.toFixed(3) }}</td><td>{{ e.from }}</td><td>{{ e.to }}</td><td><button class="sim-event-info" :data-protocol="e.protocol" :aria-label="`Inspect ${e.protocol} ${e.action} at ${e.to}`" @click="inspectEvent(e.id)">{{ e.protocol }} · {{ e.action }}</button></td></tr><tr v-if="!visibleEvents.length"><td colspan="4">{{ cursor ? 'Events ถูกซ่อนโดย filter' : 'ยังไม่มี captured events' }}</td></tr></tbody></table></div>
    <div class="sim-play-controls"><button class="quiet-button" :disabled="sharedLocked || cursor === 0" @click="back">◀ Back</button><button class="secondary-action compact sim-auto-play" :disabled="sharedLocked || !remaining" :aria-pressed="playing" @click="autoPlay">{{ playing ? 'Ⅱ Pause' : '▶ Auto Capture / Play' }}</button><button class="primary-action compact sim-forward" :disabled="sharedLocked || !remaining || playing" @click="forward">Capture / Forward ▷</button></div>
    <div class="sim-play-options"><label>Speed<select v-model="speed" aria-label="Simulation playback speed" :disabled="sharedLocked" @change="shared && roomCommand('speed', { speed: Number(speed) })"><option :value=".5">0.5x</option><option :value="1">1x</option><option :value="2">2x</option><option :value="4">4x</option></select></label><button class="quiet-button sim-replay" :disabled="sharedLocked || !events.length" @click="replay">Replay</button><button class="quiet-button sim-reset"  :disabled="sharedLocked" @click="shared ? stopPlayback() : reset()">Reset Simulation</button></div>
    <div class="simulation-stats"><span>PDUs <b>{{ pdus.length }}</b></span><span>Successful <b class="stat-good">{{ stats.success }}</b></span><span>Failed <b class="stat-bad">{{ stats.failed }}</b></span></div>
    <div class="sim-pdu-list"><strong>รายการทดสอบ</strong><table><thead><tr><th>PDU</th><th>Source → Destination</th><th>Status</th></tr></thead><tbody><tr v-for="p in pdus" :key="p.id"><td>{{ p.id }}<small>{{ p.protocol }}</small></td><td>{{ topology.nodes.find(n => n.id === p.source)?.label || p.source }} → {{ topology.nodes.find(n => n.id === p.target)?.label || p.target }}<small v-if="p.scenarioName">{{ p.scenarioName }}</small></td><td :class="pduStatus(p, captured) === 'Failed' ? 'stat-bad' : pduStatus(p, captured) === 'Successful' ? 'stat-good' : ''">{{ pduStatus(p, captured) }}<small v-if="p.expected">Expected {{ p.expected === 'failed' ? 'Failed' : 'Successful' }}</small></td></tr></tbody></table></div>
    <section v-if="selected" class="sim-inspector" aria-label="PDU Information"><div class="sim-event-heading"><strong>PDU Information · {{ selected.to }}</strong><span>{{ selected.pduId }}</span></div><div class="sim-detail-tabs" role="group" aria-label="PDU detail view"><button v-for="label in ['OSI Model','Inbound PDU Details','Outbound PDU Details']" :key="label" :class="{ active: detailTab === label }" :aria-pressed="detailTab === label" @click="detailTab = label">{{ label }}</button></div><div v-if="selected.reason" class="sim-drop-reason"><p>{{ failureSummary(selected.reason) }}</p><details><summary>รายละเอียดทางเทคนิค</summary><p>{{ selected.reason }}</p></details></div><ol v-if="detailTab === 'OSI Model'" class="sim-osi-layers"><li v-for="l in selected.layers" :key="l.layer"><span>L{{ l.layer }} {{ l.name }}</span><p>{{ l.text }}</p></li></ol><dl v-else class="sim-header-fields"><template v-for="f in detailTab === 'Inbound PDU Details' ? selected.inbound : selected.outbound" :key="f.name"><dt>{{ f.name }}</dt><dd>{{ f.value }}</dd></template></dl><p v-if="detailTab !== 'OSI Model' && !(detailTab === 'Inbound PDU Details' ? selected.inbound : selected.outbound).length" class="sim-model-note">{{ detailTab === 'Inbound PDU Details' ? 'PDU สร้างที่อุปกรณ์นี้ ยังไม่มี inbound frame' : 'ไม่มี outbound frame ใน event นี้' }}</p></section>
    <details class="sim-arp-table"><summary>Simulated ARP table · {{ arpTable.length }} entries</summary><table><thead><tr><th>Device</th><th>IPv4</th><th>MAC</th></tr></thead><tbody><tr v-for="a in arpTable" :key="`${a.deviceId}:${a.ip}`"><td>{{ a.device }}</td><td>{{ a.ip }}</td><td>{{ a.mac }}</td></tr></tbody></table></details>
    <details class="sim-limitations"><summary>ขอบเขตการจำลอง</summary><p>ตรวจ Gateway, พอร์ต/VLAN, Connected/Static Route ตาม longest prefix, ARP next hop, TTL และเส้นทางกลับตาม Config จริงใน Lab ต้องเปิด Service สำหรับ TCP/UDP/HTTP ไม่เดา Gateway หรือ Service ให้ ไม่ใช่ Engine ของ Cisco: ยังไม่จำลอง IOS, SVI/subinterface, MAC learning/STP, Dynamic Routing, NAT หรือ Service จริง IPv6 ใช้สำหรับวางแผน</p></details>
  </section>
</template>
