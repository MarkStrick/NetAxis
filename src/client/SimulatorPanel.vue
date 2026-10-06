<script setup>
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { buildPdu, pduStatus, protocols } from './lib/simulator.js'
import { scenarioTopology } from '../shared/templates.js'
const props = defineProps({ topology: { type: Object, required: true }, resetKey: Number, scenarios: { type: Array, default: () => [] }, initialMode: { type: String, default: 'Simulation' } })
const emit = defineEmits(['close', 'packets', 'picking'])
const mode = ref(props.initialMode), source = ref(props.topology.nodes[0]?.id || ''), target = ref(props.topology.nodes[1]?.id || '')
const protocol = ref('ICMP'), ttl = ref(64), port = ref(80), payload = ref(32), speed = ref(1)
const pdus = ref([]), events = ref([]), cursor = ref(0), selectedId = ref(''), detailTab = ref('OSI Model'), filters = ref([...protocols]), playing = ref(false), message = ref(''), picking = ref('')
const eventList = ref(null)
const scenarioId = ref(props.scenarios[0]?.id || '')
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
function marker(event, value = 1) { emit('packets', event ? [{ id: event.id, eventId: event.id, protocol: event.protocol, route: event.route, edgeIndex: 0, progress: value, active: true, failed: event.terminal === 'failed' }] : []) }
function pause() { playing.value = false; playbackGeneration++; if (frame !== null) cancelAnimationFrame(frame); frame = null }
function stopPicking() { picking.value = ''; emit('picking', { phase: '', source: '' }) }
function reset() {
  pause(); stopPicking(); pdus.value = []; events.value = []; cursor.value = 0; selectedId.value = ''; cache = new Set(); progress = 0; message.value = ''; marker(null)
}
function stopPlayback() { reset(); message.value = 'หยุดแล้ว · ล้างคิว PDU และ packet เลือก scenario เพื่อเริ่มใหม่ได้' }
function closeSimulator() { pause(); stopPicking(); marker(null); emit('close') }
function replay() { pause(); stopPicking(); cursor.value = 0; selectedId.value = ''; progress = 0; message.value = 'Scenario เริ่มต้นใหม่แล้ว'; marker(null) }
function inspectEvent(id) { pause(); selectedId.value = id; marker(selected.value) }
async function capture() {
  const event = events.value[cursor.value]
  if (!event) return
  cursor.value++; selectedId.value = event.id; marker(event)
  message.value = event.reason || `${event.protocol} · ${event.from} → ${event.to} · ${event.action}`
  if (event.terminal === 'success') message.value = `${event.pduId}: Successful${event.protocol === 'UDP' ? ' (ถึงปลายทางใน model; UDP ไม่มี ACK)' : ''}`
  await nextTick()
  if (eventList.value) eventList.value.scrollTop = eventList.value.scrollHeight
}
function forward() { pause(); progress = 0; capture() }
function back() { pause(); progress = 0; if (cursor.value > 0) cursor.value--; selectedId.value = events.value[cursor.value - 1]?.id || ''; marker(selected.value) }
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
  else pause()
}
function autoPlay() {
  if (playing.value) { pause(); message.value = 'Paused · กด Resume เพื่อเล่นต่อ หรือ Stop / Reset เพื่อล้างคิว'; return }
  if (!remaining.value) return
  playing.value = true; lastTime = performance.now()
  const generation = ++playbackGeneration
  frame = requestAnimationFrame(now => tick(now, generation))
}
function setMode(value) { mode.value = value; if (value === 'Realtime' && remaining.value && !playing.value) autoPlay(); else if (value === 'Simulation') pause() }
function configureScenario() {
  const s = activeScenario.value
  if (!s) return
  source.value = s.source; target.value = s.target; protocol.value = s.protocol
  ttl.value = s.ttl ?? 64; port.value = s.destinationPort ?? 443; payload.value = s.payloadBytes ?? 32
}
function runScenario() { if (!scenarioReady.value) return; configureScenario(); queuePdu(activeScenario.value) }
function queuePdu(scenario = null) {
  if (!source.value || !target.value || source.value === target.value) { message.value = 'เลือกอุปกรณ์ต้นทางและปลายทางคนละเครื่อง'; return }
  if (playing.value || pdus.value.length >= 10) { message.value = 'Pause ก่อนเพิ่ม PDU หรือ Reset เมื่อครบ 10 PDUs'; return }
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
  if (playing.value || pdus.value.length >= 10) return
  mode.value = 'Simulation'; protocol.value = 'ICMP'; picking.value = 'source'; source.value = ''; target.value = ''; message.value = 'Simple PDU: คลิกอุปกรณ์ต้นทางบน canvas แล้วคลิกปลายทาง'; emit('picking', { phase: 'source', source: '' })
}
function pickNode(id) {
  if (!props.topology.nodes.some(n => n.id === id)) return
  if (picking.value === 'source') { source.value = id; picking.value = 'target'; message.value = 'เลือกอุปกรณ์ปลายทาง'; emit('picking', { phase: 'target', source: id }) }
  else if (picking.value === 'target') { target.value = id; queuePdu() }
}
watch(() => props.resetKey, reset)
watch(() => props.scenarios, () => { if (!props.scenarios.some(s => s.id === scenarioId.value)) scenarioId.value = props.scenarios[0]?.id || ''; if (!playing.value && !events.value.length) configureScenario() }, { immediate: true })
watch(() => JSON.stringify({ nodes: props.topology.nodes.map(n => [n.id, n.label, n.type, n.data]), edges: props.topology.edges.map(e => [e.id, e.sourceNodeId, e.targetNodeId, e.status, e.medium]) }), () => {
  const hadEvents = events.value.length; reset()
  if (hadEvents) message.value = 'Topology/config เปลี่ยนแล้ว จึงล้าง scenario เพื่อใช้ข้อมูลปัจจุบัน'
  if (!props.topology.nodes.some(n => n.id === source.value)) source.value = props.topology.nodes[0]?.id || ''
  if (!props.topology.nodes.some(n => n.id === target.value)) target.value = props.topology.nodes.find(n => n.id !== source.value)?.id || ''
})
onBeforeUnmount(() => { pause(); stopPicking(); marker(null) })
defineExpose({ pickNode, inspectEvent, cancelPick: stopPicking, reset })
</script>

<template>
  <section class="simulation-panel packet-tracer-panel" aria-label="Network Simulator" @pointerdown.stop @pointermove.stop @pointerup.stop @click.stop @keydown.stop @wheel.stop>
    <div class="sim-control-dock">
      <header class="simulation-panel-heading"><div><p class="eyebrow">NETAXIS PACKET SIMULATOR</p><strong>Simulation Panel</strong></div><button class="panel-close" aria-label="Close Simulator" @click="closeSimulator">×</button></header>
      <div class="sim-mode-tabs" role="group" aria-label="Simulator mode"><button :class="{ active: mode === 'Realtime' }" :aria-pressed="mode === 'Realtime'" @click="setMode('Realtime')">◷ Realtime</button><button :class="{ active: mode === 'Simulation' }" :aria-pressed="mode === 'Simulation'" @click="setMode('Simulation')">▣ Simulation</button></div>
      <div class="sim-transport" role="group" aria-label="Playback controls"><button class="secondary-action compact sim-pause-resume" :disabled="!playing && !remaining" :aria-pressed="playing" @click="autoPlay">{{ playing ? 'Ⅱ Pause' : '▶ Resume / Play' }}</button><button class="quiet-button sim-stop" :disabled="!pdus.length && !playing" @click="stopPlayback">■ Stop / Reset</button><span role="status">{{ playing ? 'Running' : remaining ? 'Paused / Ready' : pdus.length ? 'Completed' : 'Idle' }}</span></div>
    </div>
    <p class="sim-model-note">Educational model · Realtime เป็นการเล่นอัตโนมัติใน topology · ใช้ Live Verify สำหรับตรวจ network จริง</p>
    <section v-if="scenarios.length" class="sim-ready-scenarios"><p class="eyebrow">READY TO RUN · REFERENCE SCENARIOS</p><label>Scenario<select v-model="scenarioId" aria-label="Ready scenario" :disabled="playing" @change="configureScenario"><option v-for="s in scenarios" :key="s.id" :value="s.id">{{ s.name }}</option></select></label><p class="sim-model-note">Expected {{ activeScenario?.expected === 'failed' ? 'Failed' : 'Successful' }}{{ activeScenario?.note ? ` · ${activeScenario.note}` : '' }}</p><p v-if="!scenarioReady" class="sim-drop-reason">อุปกรณ์หรือสายที่ scenario ต้องใช้ถูกลบแล้ว เลือก Source/Destination เองด้านล่าง</p><button class="primary-action compact sim-run-scenario" :disabled="playing || !scenarioReady || pdus.length >= 10" @click="runScenario">▶ Run Scenario</button></section>
    <div class="sim-pdu-tools"><button class="secondary-action compact sim-simple-pdu" :class="{ active: picking }" :disabled="playing || pdus.length >= 10" @click="simplePdu">✉ Add Simple PDU</button><button v-if="picking" class="quiet-button" @click="stopPicking">ยกเลิกการเลือก</button></div>
    <fieldset class="simulation-fields" :disabled="playing || Boolean(picking)">
      <label>Source<select v-model="source" aria-label="PDU source"><option value="" disabled>Select source</option><option v-for="n in topology.nodes" :key="n.id" :value="n.id">{{ n.label }}</option></select></label>
      <label>Destination<select v-model="target" aria-label="PDU destination"><option value="" disabled>Select destination</option><option v-for="n in topology.nodes" :key="n.id" :value="n.id">{{ n.label }}</option></select></label>
      <label>Protocol<select v-model="protocol" aria-label="PDU protocol" @change="port = protocol === 'UDP' ? 53 : 80"><option v-for="p in ['ICMP', 'ARP', 'TCP', 'UDP']" :key="p">{{ p }}</option></select></label>
      <label>TTL<input v-model.number="ttl" type="number" min="1" max="255" aria-label="PDU TTL" /></label>
      <label v-if="['TCP','UDP'].includes(protocol)">Destination port<input v-model.number="port" type="number" min="1" max="65535" aria-label="PDU destination port" /></label>
      <label>Payload bytes<input v-model.number="payload" type="number" min="0" max="1400" aria-label="PDU payload bytes" /></label>
    </fieldset>
    <button class="primary-action compact sim-add-pdu" :disabled="playing || Boolean(picking) || !source || !target || source === target || pdus.length >= 10" @click="queuePdu()">+ Add {{ protocol === 'ICMP' ? 'Simple' : 'Complex' }} PDU</button>
    <p class="simulation-message" role="status">{{ message || 'เพิ่ม PDU แล้วใช้ Capture / Forward เพื่อดูทีละ event' }}</p>
    <div class="sim-event-heading"><strong>Event List</strong><span>Captured {{ cursor }} / {{ events.length }} · {{ events[cursor - 1]?.time.toFixed(3) || '0.000' }} s</span></div>
    <div class="sim-event-filters" role="group" aria-label="Visible event filters"><label v-for="p in protocols" :key="p"><input v-model="filters" type="checkbox" :value="p" :aria-label="`${p} event filter`" /><span :data-protocol="p">{{ p }}</span></label><button class="quiet-button" @click="filters = [...protocols]">Show All</button><button class="quiet-button" @click="filters = []">None</button></div>
    <div ref="eventList" class="sim-event-list"><table><thead><tr><th>Time</th><th>Last device</th><th>At device</th><th>Type / Info</th></tr></thead><tbody><tr v-for="e in visibleEvents" :key="e.id" :class="{ selected: selectedId === e.id, failed: e.terminal === 'failed' }"><td>{{ e.time.toFixed(3) }}</td><td>{{ e.from }}</td><td>{{ e.to }}</td><td><button class="sim-event-info" :data-protocol="e.protocol" :aria-label="`Inspect ${e.protocol} ${e.action} at ${e.to}`" @click="inspectEvent(e.id)">{{ e.protocol }} · {{ e.action }}</button></td></tr><tr v-if="!visibleEvents.length"><td colspan="4">{{ cursor ? 'Events ถูกซ่อนโดย filter' : 'ยังไม่มี captured events' }}</td></tr></tbody></table></div>
    <div class="sim-play-controls"><button class="quiet-button" :disabled="cursor === 0" @click="back">◀ Back</button><button class="secondary-action compact sim-auto-play" :disabled="!remaining" :aria-pressed="playing" @click="autoPlay">{{ playing ? 'Ⅱ Pause' : '▶ Auto Capture / Play' }}</button><button class="primary-action compact sim-forward" :disabled="!remaining || playing" @click="forward">Capture / Forward ▷</button></div>
    <div class="sim-play-options"><label>Speed<select v-model="speed" aria-label="Simulation playback speed"><option :value=".5">0.5x</option><option :value="1">1x</option><option :value="2">2x</option><option :value="4">4x</option></select></label><button class="quiet-button sim-replay" :disabled="!events.length" @click="replay">Replay</button><button class="quiet-button sim-reset" @click="reset">Reset Simulation</button></div>
    <div class="simulation-stats"><span>PDUs <b>{{ pdus.length }}</b></span><span>Successful <b class="stat-good">{{ stats.success }}</b></span><span>Failed <b class="stat-bad">{{ stats.failed }}</b></span></div>
    <div class="sim-pdu-list"><strong>User Created PDU List</strong><table><thead><tr><th>PDU</th><th>Source → Destination</th><th>Status</th></tr></thead><tbody><tr v-for="p in pdus" :key="p.id"><td>{{ p.id }}<small>{{ p.protocol }}</small></td><td>{{ p.source }} → {{ p.target }}<small v-if="p.scenarioName">{{ p.scenarioName }}</small></td><td :class="pduStatus(p, captured) === 'Failed' ? 'stat-bad' : pduStatus(p, captured) === 'Successful' ? 'stat-good' : ''">{{ pduStatus(p, captured) }}<small v-if="p.expected">Expected {{ p.expected === 'failed' ? 'Failed' : 'Successful' }}</small></td></tr></tbody></table></div>
    <section v-if="selected" class="sim-inspector" aria-label="PDU Information"><div class="sim-event-heading"><strong>PDU Information · {{ selected.to }}</strong><span>{{ selected.pduId }}</span></div><div class="sim-detail-tabs" role="group" aria-label="PDU detail view"><button v-for="label in ['OSI Model','Inbound PDU Details','Outbound PDU Details']" :key="label" :class="{ active: detailTab === label }" :aria-pressed="detailTab === label" @click="detailTab = label">{{ label }}</button></div><p v-if="selected.reason" class="sim-drop-reason">{{ selected.reason }}</p><ol v-if="detailTab === 'OSI Model'" class="sim-osi-layers"><li v-for="l in selected.layers" :key="l.layer"><span>L{{ l.layer }} {{ l.name }}</span><p>{{ l.text }}</p></li></ol><dl v-else class="sim-header-fields"><template v-for="f in detailTab === 'Inbound PDU Details' ? selected.inbound : selected.outbound" :key="f.name"><dt>{{ f.name }}</dt><dd>{{ f.value }}</dd></template></dl><p v-if="detailTab !== 'OSI Model' && !(detailTab === 'Inbound PDU Details' ? selected.inbound : selected.outbound).length" class="sim-model-note">{{ detailTab === 'Inbound PDU Details' ? 'PDU สร้างที่อุปกรณ์นี้ ยังไม่มี inbound frame' : 'ไม่มี outbound frame ใน event นี้' }}</p></section>
    <details class="sim-arp-table"><summary>Simulated ARP table · {{ arpTable.length }} entries</summary><table><thead><tr><th>Device</th><th>IPv4</th><th>MAC</th></tr></thead><tbody><tr v-for="a in arpTable" :key="`${a.deviceId}:${a.ip}`"><td>{{ a.device }}</td><td>{{ a.ip }}</td><td>{{ a.mac }}</td></tr></tbody></table></details>
    <details class="sim-limitations"><summary>Model scope</summary><p>ใช้ topology path และ IPv4/VLAN ของ node จำลอง ARP broadcast, ICMP round trip, TCP handshake/data, UDP และ TTL ที่ router ไม่มี IOS CLI, routing protocol, per-interface IP, ACL/NAT หรือ service จริง MAC ที่ไม่ระบุจะสร้างสำหรับ simulation เวลาใน event เป็นเวลาจำลอง</p></details>
  </section>
</template>
