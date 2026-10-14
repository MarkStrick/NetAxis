<script setup>
import { computed, ref, watch } from 'vue'
import DialogFrame from './DialogFrame.vue'
import { emptyFlowchart, flowShapes, parseFlowchart, networkFlowchart } from './lib/flowchart.js'
const props = defineProps({ roomId: String, topology: Object, writable: Boolean })
defineEmits(['close'])
const chart = ref(emptyFlowchart()), selectedId = ref(''), tab = ref('manual'), error = ref(''), notice = ref(''), pendingImport = ref(null)
const source = ref(''), target = ref(''), protocol = ref('ICMP'), arrowSource = ref(''), arrowTarget = ref(''), arrowLabel = ref(''), svg = ref(null), history = ref([])
const storageKey = `netaxis-flowchart:${props.roomId}`
// shortcut: drafts stay in this browser; add room storage when shared editing is needed.
try { const saved = localStorage.getItem(storageKey); if (saved) chart.value = parseFlowchart(JSON.parse(saved)) } catch { error.value = 'เปิดงานที่เก็บไว้ไม่ได้ กรุณานำเข้าจากไฟล์สำรอง' }
watch(chart, value => { try { localStorage.setItem(storageKey, JSON.stringify(value)); notice.value = 'บันทึกในเบราว์เซอร์นี้แล้ว' } catch { error.value = 'บันทึกในเบราว์เซอร์ไม่ได้ กรุณาดาวน์โหลด JSON เพื่อเก็บงาน' } }, { deep: true })
const selected = computed(() => chart.value.nodes.find(n => n.id === selectedId.value))
const width = computed(() => Math.max(800, ...chart.value.nodes.map(n => n.x + 240)))
const height = computed(() => Math.max(500, ...chart.value.nodes.map(n => n.y + 140)))
const nodeMap = computed(() => new Map(chart.value.nodes.map(n => [n.id, n])))
function remember() { history.value.push(JSON.stringify(chart.value)); if (history.value.length > 30) history.value.shift(); error.value = '' }
function undo() { const value = history.value.pop(); if (value) { chart.value = JSON.parse(value); selectedId.value = '' } }
function add(shape) {
  if (!props.writable) return
  if (chart.value.nodes.length >= 100) { error.value = 'เพิ่มได้สูงสุด 100 กล่อง'; return }
  remember(); const count = chart.value.nodes.length
  const node = { id: crypto.randomUUID(), shape, label: flowShapes[shape], x: 40 + (count % 3) * 240, y: 40 + Math.floor(count / 3) * 140 }
  chart.value.nodes.push(node); selectedId.value = node.id
}
function update(field, value) {
  if (!props.writable || !selected.value) return
  if (['x', 'y'].includes(field)) { value = Number(value); if (!Number.isFinite(value) || value < 0 || value > (field === 'x' ? 10000 : 20000)) { error.value = 'พิกัดอยู่นอกพื้นที่วาด'; return } }
  remember(); selected.value[field] = value
}
function removeNode() { if (!props.writable || !selected.value) return; remember(); chart.value.nodes = chart.value.nodes.filter(n => n.id !== selectedId.value); chart.value.edges = chart.value.edges.filter(e => e.source !== selectedId.value && e.target !== selectedId.value); selectedId.value = '' }
function connect() {
  if (!props.writable) return
  if (!nodeMap.value.has(arrowSource.value) || !nodeMap.value.has(arrowTarget.value) || arrowSource.value === arrowTarget.value) { error.value = 'เลือกลูกศรระหว่างกล่องคนละกล่อง'; return }
  if (chart.value.edges.length >= 200) { error.value = 'เพิ่มได้สูงสุด 200 ลูกศร'; return }
  remember(); chart.value.edges.push({ id: crypto.randomUUID(), source: arrowSource.value, target: arrowTarget.value, label: arrowLabel.value }); arrowLabel.value = ''
}
function removeEdge(id) { if (!props.writable) return; remember(); chart.value.edges = chart.value.edges.filter(e => e.id !== id) }
function generate() {
  try { const result = networkFlowchart(props.topology, source.value, target.value, protocol.value); generated.value = result; error.value = '' } catch (e) { error.value = e.message }
}
const generated = ref(null)
watch([source, target, protocol], () => { generated.value = null })
watch(() => props.topology, () => { generated.value = null }, { deep: true })
function useGenerated() { if (!props.writable || !generated.value) return; remember(); chart.value = generated.value.chart; generated.value = null; selectedId.value = ''; tab.value = 'manual' }
async function importFile(event) {
  const file = event.target.files[0]; event.target.value = ''; if (!file || !props.writable) return
  try { if (file.size > 200000) throw Error('ไฟล์ใหญ่เกิน 200 KB'); pendingImport.value = parseFlowchart(JSON.parse(await file.text())); error.value = '' } catch (e) { error.value = `นำเข้าไม่ได้: ${e.message}` }
}
function confirmImport() { if (!props.writable || !pendingImport.value) return; remember(); chart.value = pendingImport.value; pendingImport.value = null; selectedId.value = ''; tab.value = 'manual' }
function download(name, value, type) { const url = URL.createObjectURL(new Blob([value], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
function exportSvg() { const copy = svg.value.cloneNode(true); copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('width', width.value); copy.setAttribute('height', height.value); download('netaxis-flowchart.svg', new XMLSerializer().serializeToString(copy), 'image/svg+xml') }
function lines(label) { return label.match(/.{1,22}/gu) || [''] }
function arrow(e) { const a = nodeMap.value.get(e.source), b = nodeMap.value.get(e.target); return `M ${a.x + 100} ${a.y + 80} L ${b.x + 100} ${b.y}` }
let drag = null
function startDrag(event, node) {
  selectedId.value = node.id; if (!props.writable || event.button !== 0) return
  remember(); drag = { id: node.id, x: event.clientX, y: event.clientY, initialX: node.x, initialY: node.y }; event.currentTarget.setPointerCapture(event.pointerId)
}
function moveDrag(event) { if (!drag || !props.writable) return; const node = nodeMap.value.get(drag.id); if (node) { node.x = Math.max(0, Math.min(10000, drag.initialX + event.clientX - drag.x)); node.y = Math.max(0, Math.min(20000, drag.initialY + event.clientY - drag.y)) } }
function moveKey(event, node) { const moves = { ArrowLeft: ['x', -20], ArrowRight: ['x', 20], ArrowUp: ['y', -20], ArrowDown: ['y', 20] }; if (!moves[event.key] || !props.writable) return; event.preventDefault(); selectedId.value = node.id; const [field, delta] = moves[event.key]; update(field, Math.max(0, node[field] + delta)) }
</script>

<template>
  <DialogFrame title="Flow Chart" title-id="flowchart-title" class="flowchart-dialog" @close="$emit('close')">
    <p>วาดขั้นตอนเอง หรือสร้างจากการส่งข้อมูลในเครือข่าย · งานเก็บในเบราว์เซอร์นี้ แยกตามห้อง ใช้ JSON เพื่อย้ายเครื่องหรือแชร์ให้ทีม</p>
    <p v-if="!writable" class="permission-note">ดูอย่างเดียว · สร้างตัวอย่างจากเครือข่ายและดาวน์โหลดผังที่เก็บไว้ได้ แต่แก้ไขงานไม่ได้</p>
    <div class="flow-toolbar" role="group" aria-label="รูปแบบ Flow Chart"><button class="tool-button" :aria-pressed="tab === 'manual'" @click="tab = 'manual'">วาดเอง</button><button class="tool-button" :aria-pressed="tab === 'network'" @click="tab = 'network'">จากเครือข่าย</button></div>
    <p v-if="error" role="alert" class="inline-error">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <section v-if="tab === 'network'" class="flow-network">
      <p>เลือกต้นทางและปลายทาง ระบบจะคำนวณด้วย Simulator จากการตั้งค่าปัจจุบัน รวมขาไปและขากลับ ผลนี้เป็นการจำลอง ไม่ใช่การตรวจเครือข่ายจริง</p>
      <form @submit.prevent="generate"><div class="flow-fields"><label>ต้นทาง<select v-model="source" required><option value="" disabled>เลือกอุปกรณ์</option><option v-for="n in topology.nodes" :key="n.id" :value="n.id">{{ n.label }}</option></select></label><label>ปลายทาง<select v-model="target" required><option value="" disabled>เลือกอุปกรณ์</option><option v-for="n in topology.nodes" :key="n.id" :value="n.id">{{ n.label }}</option></select></label><label>ชนิดข้อมูล<select v-model="protocol"><option>ICMP</option><option>TCP</option><option>UDP</option><option>HTTP</option></select></label></div><button class="primary-action compact">สร้างตัวอย่าง Flow Chart</button></form>
      <section v-if="generated" class="flow-result" aria-label="ผลจากเครือข่าย"><h3>{{ generated.outcome === 'success' ? 'ส่งสำเร็จ' : 'ส่งไม่สำเร็จ' }}</h3><p v-if="generated.reason">{{ generated.reason }}</p><ol><li v-for="n in generated.chart.nodes" :key="n.id">{{ n.label }}</li></ol><p>ใช้ผลนี้จะแทน Flow Chart ที่วาดไว้ สามารถเลิกทำได้</p><button class="secondary-action compact" :disabled="!writable" @click="useGenerated">ใช้ผลนี้เป็น Flow Chart</button></section>
      <p v-if="topology.nodes.length < 2">เพิ่มอุปกรณ์อย่างน้อย 2 เครื่องในผังเครือข่ายก่อนสร้างตัวอย่าง</p>
    </section>
    <section v-else>
      <div class="flow-toolbar"><button v-for="(label, shape) in flowShapes" :key="shape" class="secondary-action compact" :disabled="!writable" @click="add(shape)">+ {{ label }}</button><button class="quiet-button" :disabled="!writable || !history.length" @click="undo">เลิกทำ</button></div>
      <p>ลากกล่องเพื่อย้าย หรือเลือกกล่องแล้วใช้ปุ่มลูกศรบนแป้นพิมพ์ แก้ข้อความและตำแหน่งได้ด้านล่าง</p>
      <div class="flow-canvas" tabindex="0" aria-label="พื้นที่วาด Flow Chart เลื่อนเพื่อดูผังทั้งหมด">
        <svg ref="svg" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="group" aria-label="ผังขั้นตอน" style="background: #f8fafc; font-family: sans-serif;">
          <defs><marker id="flow-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#475569" /></marker></defs>
          <g v-for="e in chart.edges" :key="e.id"><path :d="arrow(e)" stroke="#475569" stroke-width="2" fill="none" marker-end="url(#flow-arrow)" /><text :x="(nodeMap.get(e.source).x + nodeMap.get(e.target).x) / 2 + 110" :y="(nodeMap.get(e.source).y + nodeMap.get(e.target).y) / 2 + 40" font-size="14" fill="#17253a">{{ e.label }}</text></g>
          <g v-for="n in chart.nodes" :key="n.id" :transform="`translate(${n.x}, ${n.y})`" role="button" tabindex="0" :aria-label="`${flowShapes[n.shape]}: ${n.label}`" :aria-pressed="selectedId === n.id" style="touch-action: none; cursor: grab;" @click="selectedId = n.id" @keydown.enter.prevent="selectedId = n.id" @keydown.space.prevent="selectedId = n.id" @keydown="moveKey($event, n)" @pointerdown="startDrag($event, n)" @pointermove="moveDrag" @pointerup="drag = null" @pointercancel="drag = null" @lostpointercapture="drag = null">
            <path v-if="n.shape === 'decision'" d="M100,0 L200,40 L100,80 L0,40 Z" fill="#fff7e5" :stroke="selectedId === n.id ? '#2563eb' : '#946521'" stroke-width="2" />
            <rect v-else width="200" height="80" :rx="n.shape === 'terminator' ? 40 : 8" fill="#ffffff" :stroke="selectedId === n.id ? '#2563eb' : '#475569'" stroke-width="2" />
            <text x="100" :y="40 - (lines(n.label).length - 1) * 7" text-anchor="middle" fill="#17253a" font-size="12"><tspan v-for="(line, i) in lines(n.label)" :key="i" x="100" :dy="i ? 14 : 0">{{ line }}</tspan></text>
          </g>
        </svg>
      </div>
      <p v-if="!chart.nodes.length">ยังไม่มี Flow Chart · เพิ่มกล่องขั้นตอน หรือเลือก “จากเครือข่าย” เพื่อเริ่มต้น</p>
      <fieldset v-if="selected" :disabled="!writable" class="flow-editor"><legend>แก้ไขกล่องที่เลือก</legend><div class="flow-fields"><label>ข้อความ<input :value="selected.label" maxlength="120" @change="update('label', $event.target.value)" /></label><label>รูปแบบ<select :value="selected.shape" @change="update('shape', $event.target.value)"><option v-for="(label, shape) in flowShapes" :key="shape" :value="shape">{{ label }}</option></select></label><label>ตำแหน่ง X<input :value="selected.x" type="number" min="0" max="10000" @change="update('x', $event.target.value)" /></label><label>ตำแหน่ง Y<input :value="selected.y" type="number" min="0" max="20000" @change="update('y', $event.target.value)" /></label></div><button class="delete-button" @click="removeNode">ลบกล่องและลูกศรที่เชื่อม</button></fieldset>
      <form class="flow-editor" @submit.prevent="connect"><fieldset :disabled="!writable"><legend>เชื่อมลูกศร</legend><div class="flow-fields"><label>จากกล่อง<select v-model="arrowSource" required><option value="" disabled>เลือกกล่อง</option><option v-for="n in chart.nodes" :key="n.id" :value="n.id">{{ n.label }}</option></select></label><label>ไปกล่อง<select v-model="arrowTarget" required><option value="" disabled>เลือกกล่อง</option><option v-for="n in chart.nodes" :key="n.id" :value="n.id">{{ n.label }}</option></select></label><label>ข้อความบนลูกศร<input v-model="arrowLabel" maxlength="120" placeholder="เช่น ใช่ / ไม่ใช่" /></label></div><button class="secondary-action compact">เพิ่มลูกศร</button></fieldset></form>
      <ul v-if="chart.edges.length" class="flow-links"><li v-for="e in chart.edges" :key="e.id"><span>{{ nodeMap.get(e.source).label }} → {{ nodeMap.get(e.target).label }} {{ e.label }}</span><button class="quiet-button" :disabled="!writable" :aria-label="`ลบลูกศร ${nodeMap.get(e.source).label} ไป ${nodeMap.get(e.target).label}`" @click="removeEdge(e.id)">ลบ</button></li></ul>
      <div class="flow-toolbar"><button class="secondary-action compact" @click="download('netaxis-flowchart.json', JSON.stringify(chart, null, 2), 'application/json')">ดาวน์โหลด JSON</button><button class="secondary-action compact" :disabled="!chart.nodes.length" @click="exportSvg">ดาวน์โหลด SVG</button><label class="flow-import">นำเข้า JSON<input type="file" accept=".json,application/json" :disabled="!writable" @change="importFile" /></label></div>
    </section>
    <DialogFrame v-if="pendingImport" title="แทน Flow Chart ปัจจุบัน?" title-id="flow-import-title" @close="pendingImport = null"><p>นำเข้า {{ pendingImport.nodes.length }} กล่องและ {{ pendingImport.edges.length }} ลูกศรแทนงานที่วาดไว้ สามารถเลิกทำได้</p><div class="modal-actions"><button class="quiet-button" @click="pendingImport = null">ยกเลิก</button><button class="primary-action compact" @click="confirmImport">นำเข้าและแทนผัง</button></div></DialogFrame>
  </DialogFrame>
</template>

<style scoped>
.flowchart-dialog { width: min(1100px, calc(100vw - 32px)); }
.flow-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-block: 16px; }
.flow-toolbar .secondary-action { width: auto; margin: 0; }
.flow-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.flow-canvas { overflow: auto; max-height: 450px; border: 1px solid var(--line); border-radius: 8px; }
.flow-editor { margin-block: 20px; padding: 16px; border: 1px solid var(--line); border-radius: 8px; }
.flow-editor fieldset { border: 0; padding: 0; min-width: 0; }
.flow-links { padding: 0; list-style: none; }
.flow-links li { display: flex; align-items: center; gap: 12px; justify-content: space-between; border-bottom: 1px solid var(--line); padding-block: 8px; }
.flow-links span { overflow-wrap: anywhere; }
.flow-result ol { padding-inline-start: 24px; max-height: 350px; overflow: auto; line-height: 1.8; }
.flow-import { max-width: 100%; }
.flow-import input { max-width: 100%; }
svg g[role=button]:focus-visible { outline: 3px solid #2563eb; outline-offset: 4px; }
@media(max-width: 500px) { .flow-fields { grid-template-columns: 1fr; } }
</style>
