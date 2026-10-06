<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { calculateSubnet, ipv4ToInt } from '../server/lib/subnet.js'
const props = defineProps({ roomId: String, sessionId: String, role: String, request: Function, nodes: { type: Array, default: () => [] } })
const emit = defineEmits(['close'])
const steps = ['Plan', 'Calculate / Validate', 'Scale / What-if', 'IPAM', 'Live Verify']
const tab = ref(0), busy = ref(false), error = ref(''), notice = ref(''), revision = ref(0)
const form = ref({ parent: '10.20.0.0/16', segments: [], assignments: [] })
const design = ref(null), scenario = ref(null), changes = ref({}), probes = ref([]), verification = ref(null)
const selectedProbe = ref(''), target = ref(''), offset = ref(0), enrollName = ref(''), enrollSegment = ref(''), enrollment = ref(null)
const writable = computed(() => ['owner', 'editor'].includes(props.role))
const saved = ref(''), dirty = computed(() => Boolean(saved.value) && JSON.stringify(input()) !== saved.value)
const pendingExit = ref(null)
function requestClose(action = () => emit('close')) { if (busy.value) return; if (dirty.value && writable.value) pendingExit.value = action; else action() }
function discardAndLeave() { const action = pendingExit.value; pendingExit.value = null; action?.() }
async function saveAndLeave() { if (await save()) discardAndLeave() }
function beforeUnload(event) { if (dirty.value && writable.value) { event.preventDefault(); event.returnValue = '' } }
defineExpose({ requestClose })
let scenarioInput = ''
const root = computed(() => `/api/rooms/${props.roomId}/planning`)
const api = (path = '', options = {}) => props.request(root.value + path, { ...options, headers: { 'x-session-id': props.sessionId, ...(options.headers || {}) } })
function segment() { return { id: crypto.randomUUID(), name: `Department ${form.value.segments.length + 1}`, site: 'HQ', department: '', vlan: 10 + form.value.segments.length * 10, hosts: 50, growth: 20, reservedCount: 3, cidr: '', gateway: '', reservedText: '' } }
function input() { return { parent: form.value.parent, segments: form.value.segments.map(({ reservedText, ...s }) => ({ ...s, reservedIps: (reservedText || '').split(/[\s,]+/).filter(Boolean) })), assignments: form.value.assignments } }
function setForm(value) { form.value = { ...value, segments: value.segments.map(s => ({ ...s, reservedText: (s.reservedIps || []).join(', ') })) } }
async function task(fn) { if (busy.value) return false; busy.value = true; error.value = ''; notice.value = ''; try { await fn(); return true } catch (e) { error.value = e.message; return false } finally { busy.value = false } }
async function load() {
  await task(async () => {
    const result = await api()
    if (result.plan) { setForm(result.plan.input); design.value = result.plan.design; revision.value = result.plan.revision }
    else form.value.segments = [segment()]
    saved.value = JSON.stringify(input()); await refresh()
  })
}
async function calculate() { await task(async () => { design.value = (await api('/calculate', { method: 'POST', body: JSON.stringify(input()) })).design; scenario.value = null; tab.value = 1 }) }
async function save() { return task(async () => {
  const result = await api('', { method: 'PUT', body: JSON.stringify({ input: input(), revision: revision.value }) })
  revision.value = result.plan.revision; design.value = result.plan.design; saved.value = JSON.stringify(input()); notice.value = 'บันทึกแผนแล้ว'; await refresh()
}) }
async function scale() { await task(async () => { scenarioInput = JSON.stringify(input()); scenario.value = await api('/scale', { method: 'POST', body: JSON.stringify({ input: input(), changes: changes.value }) }) }) }
function applyScenario() {
  if (scenarioInput !== JSON.stringify(input())) { error.value = 'Draft เปลี่ยนแล้ว กรุณา Compare designs ใหม่'; return }
  form.value.segments.forEach(s => { s.hosts = scenario.value.after.segments.find(v => v.id === s.id).hosts; s.cidr = ''; s.gateway = '' })
  design.value = scenario.value.after; scenario.value = null; notice.value = 'ใช้ scenario ใน draft แล้ว ตรวจ IP เดิมและบันทึกเพื่อยืนยัน'; tab.value = 1
}
async function refresh() {
  const [p, v] = await Promise.all([api('/probes'), api('/verification')])
  probes.value = p.probes; verification.value = v
  if (!probes.value.some(p => p.id === selectedProbe.value)) selectedProbe.value = probes.value[0]?.id || ''
}
async function enroll() { await task(async () => { enrollment.value = await api('/probes', { method: 'POST', body: JSON.stringify({ name: enrollName.value, segmentId: enrollSegment.value }) }); await refresh() }) }
async function revoke(id) { await task(async () => { await api(`/probes/${id}`, { method: 'DELETE' }); await refresh(); enrollment.value = null }) }
async function queue(kind) { await task(async () => {
  const job = await api(`/probes/${selectedProbe.value}/jobs`, { method: 'POST', body: JSON.stringify({ kind, ...(['host', 'traceroute'].includes(kind) ? { target: target.value } : {}), offset: offset.value }) })
  notice.value = `${kind} queued · ${job.coverage}/${job.totalUsable} usable IPs (offset ${job.offset})`; await refresh()
}) }
async function importTopology() { await task(async () => {
  design.value = (await api('/calculate', { method: 'POST', body: JSON.stringify(input()) })).design
  let count = 0
  for (const node of props.nodes) {
    const address = ipv4ToInt(node.data?.ipv4 || '')
    if (address === null || form.value.assignments.some(a => a.ip === node.data.ipv4)) continue
    const s = design.value.segments.find(s => { if (!s.cidr || node.data.ipv4 === s.gateway) return false; const [ip, prefix] = s.cidr.split('/'), n = calculateSubnet(ip, prefix); return address >= ipv4ToInt(n.firstUsable) && address <= ipv4ToInt(n.lastUsable) })
    if (s) { form.value.assignments.push({ segmentId: s.id, ip: node.data.ipv4, kind: node.type === 'server' ? 'server' : 'device', label: node.label, mac: node.data.mac || '' }); count++ }
  }
  notice.value = `นำเข้า ${count} IP จาก topology แล้ว (ข้าม gateway, network/broadcast, IP นอกแผนหรือซ้ำ)`
}) }
function downloadConfig() {
  const p = enrollment.value
  const content = `NETAXIS_SERVER=${import.meta.env.VITE_SOCKET_ORIGIN || import.meta.env.VITE_API_BASE || window.location.origin}\nNETAXIS_PROBE_ID=${p.id}\nNETAXIS_PROBE_TOKEN=${p.token}\nNETAXIS_PROBE_NETWORK=${p.network}\n`
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' })), a = document.createElement('a')
  a.href = url; a.download = '.env.probe'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
let timer, disposed = false
onMounted(async () => { window.addEventListener('beforeunload', beforeUnload); await load(); if (!disposed) timer = setInterval(() => { if (tab.value === 4 && !busy.value) refresh().catch(e => { error.value = e.message }) }, 5000) })
onBeforeUnmount(() => { disposed = true; clearInterval(timer); window.removeEventListener('beforeunload', beforeUnload) })
const selected = computed(() => probes.value.find(p => p.id === selectedProbe.value))
</script>

<template>
  <main class="planning-page">
    <header class="planning-heading">
      <div><p class="eyebrow">NETAXIS · NETWORK ENGINEERING</p><h1>Plan. Scale. Verify.</h1><p>IPv4 planning, VLSM, IPAM และเทียบกับเครือข่ายจริงของแต่ละ segment</p></div>
      <div class="planning-actions"><span class="revision-tag">Plan r{{ revision }} {{ dirty ? '· Draft' : '' }}</span><button class="quiet-button" :disabled="busy" @click="requestClose()">กลับ Topology</button><button class="primary-action" :disabled="busy || !writable" @click="save">บันทึกแผน</button></div>
    </header>
    <nav class="planning-steps" aria-label="ขั้นตอนการวางแผน"><button v-for="(step, i) in steps" :key="step" :class="{ active: tab === i }" :aria-current="tab === i ? 'step' : undefined" @click="tab = i"><span>{{ i + 1 }}</span>{{ step }}</button></nav>
    <p v-if="error" class="planning-message error" role="alert">{{ error }} <button class="quiet-button" :disabled="busy" @click="requestClose(load)">โหลดแผนจาก Server ใหม่</button></p>
    <p v-if="notice" class="planning-message" role="status">{{ notice }}</p>
    <p v-if="!writable" class="planning-message">Viewer · ดูแผนและผลการตรวจได้</p>

    <section v-if="tab === 0" class="planning-surface">
      <div class="section-heading"><h2>Planning / Requirements</h2><p>แต่ละแถวคือ subnet ของ site / department / VLAN · Gateway 1 IP ถูกกันไว้เสมอ</p></div>
      <fieldset :disabled="busy || !writable">
        <label class="planning-parent">Parent network<input v-model="form.parent" placeholder="10.20.0.0/16" /></label>
        <div class="planning-table"><table><thead><tr><th>Segment</th><th>Site</th><th>Department</th><th>VLAN</th><th>Hosts</th><th>Growth %</th><th>Reserved</th><th></th></tr></thead><tbody><tr v-for="s in form.segments" :key="s.id"><td><input v-model="s.name" aria-label="Segment name" /></td><td><input v-model="s.site" aria-label="Site" /></td><td><input v-model="s.department" aria-label="Department" /></td><td><input v-model.number="s.vlan" type="number" min="1" max="4094" aria-label="VLAN" /></td><td><input v-model.number="s.hosts" type="number" min="1" aria-label="Hosts" /></td><td><input v-model.number="s.growth" type="number" min="0" max="1000" aria-label="Growth percent" /></td><td><input v-model.number="s.reservedCount" type="number" min="0" aria-label="Reserved IP count" /></td><td><button class="delete-button" :disabled="form.segments.length === 1" aria-label="Remove segment" @click="form.segments = form.segments.filter(v => v.id !== s.id)">×</button></td></tr></tbody></table></div>
        <button class="secondary-action" :disabled="form.segments.length >= 100" @click="form.segments.push(segment())">+ เพิ่ม Site / Department / VLAN</button>
        <details class="planning-overrides"><summary>Manual subnet / gateway / reserved IP (optional)</summary><div v-for="s in form.segments" :key="s.id" class="planning-override-row"><strong>{{ s.name }}</strong><label>Subnet<input v-model="s.cidr" placeholder="Auto VLSM" /></label><label>Gateway<input v-model="s.gateway" placeholder="First usable" /></label><label>Reserved IPs<input v-model="s.reservedText" placeholder="คั่นด้วย comma" /></label></div></details>
      </fieldset>
      <footer class="planning-footer"><p>{{ form.segments.length }} subnets · {{ new Set(form.segments.map(s => s.site)).size }} sites · {{ form.segments.reduce((sum, s) => sum + Number(s.hosts || 0), 0) }} hosts ก่อน growth</p><button class="primary-action" :disabled="busy" @click="calculate">Calculate & Validate →</button></footer>
    </section>

    <section v-else-if="tab === 1" class="planning-surface">
      <div class="section-heading"><h2>Design / Calculate / Validate</h2><button class="secondary-action" :disabled="busy" @click="calculate">คำนวณใหม่</button></div>
      <template v-if="design">
        <div class="planning-summary"><div><span>Parent</span><strong>{{ design.parent }}</strong></div><div><span>Subnets</span><strong>{{ design.segments.length }}</strong></div><div><span>Validation</span><strong :class="{ 'planning-danger': design.issues.length }">{{ design.issues.length ? `${design.issues.length} issues` : 'Passed' }}</strong></div></div>
        <div class="planning-table"><table><thead><tr><th>Segment / VLAN</th><th>Network</th><th>Broadcast</th><th>Usable range</th><th>Gateway / Reserved</th><th>Hosts + growth</th><th>Capacity / wasted</th><th>Utilization</th></tr></thead><tbody><tr v-for="s in design.segments" :key="s.id"><td>{{ s.name }}<small>{{ s.site }} · VLAN {{ s.vlan }}</small></td><td class="mono">{{ s.cidr || 'No capacity' }}</td><td class="mono">{{ s.broadcast }}</td><td class="mono">{{ s.firstUsable }}<small>→ {{ s.lastUsable }}</small></td><td class="mono">{{ s.gateway }}<small>{{ s.reservedIps.join(', ') || 'ไม่มี reserved' }}</small></td><td>{{ s.hosts }} → {{ s.demand }}</td><td>{{ s.usableCapacity }} / {{ s.wasted }}</td><td :class="{ 'planning-danger': s.insufficient }"><meter min="0" max="100" :value="Math.min(100, s.utilization)" :aria-label="`${s.name} utilization`" /> {{ s.utilization }}%</td></tr></tbody></table></div>
        <p class="planning-hint">Capacity หัก gateway และ reserved แล้ว · Wasted = capacity − hosts หลัง growth · Design utilization เป็นความต้องการตามแผน ไม่ใช่ host ที่ตรวจพบจริง</p>
        <ul v-if="design.issues.length" class="planning-issues"><li v-for="(issue, i) in design.issues" :key="i"><span>{{ issue.code }}</span>{{ design.segments.find(s => s.id === issue.segmentId)?.name }} · {{ issue.message }}</li></ul>
        <p v-else class="planning-message">ไม่พบ overlap, duplicate IP/gateway, IP นอก subnet, network/broadcast usage, capacity หรือ reserved conflict</p>
      </template><p v-else class="empty-state">กำหนด requirement แล้วกด Calculate</p>
    </section>

    <section v-else-if="tab === 2" class="planning-surface">
      <div class="section-heading"><h2>Scale / What-if</h2><p>เปลี่ยนจำนวน hosts เพื่อเปรียบเทียบ VLSM ใหม่ โดยแผนที่บันทึกยังไม่เปลี่ยน</p></div>
      <fieldset :disabled="busy"><div class="planning-scale-inputs"><label v-for="s in form.segments" :key="s.id">{{ s.name }} · ปัจจุบัน {{ s.hosts }} hosts<input :value="changes[s.id] ?? s.hosts" type="number" min="1" @input="changes[s.id] = Number($event.target.value)" /></label></div></fieldset>
      <button class="primary-action" :disabled="busy" @click="scale">Compare designs</button>
      <template v-if="scenario"><div class="planning-table"><table><thead><tr><th>Segment</th><th>Hosts ก่อน → หลัง</th><th>Subnet ก่อน</th><th>Subnet หลัง</th><th>ผลกระทบ</th></tr></thead><tbody><tr v-for="s in scenario.comparison" :key="s.id"><td>{{ s.name }}</td><td>{{ s.hostsBefore }} → {{ s.hostsAfter }}</td><td class="mono">{{ s.before }}</td><td class="mono">{{ s.after || 'Parent เต็ม' }}</td><td :class="{ 'planning-danger': s.oldSubnetInsufficient || s.action === 'no-capacity' }">{{ s.oldSubnetInsufficient ? 'Subnet เดิมไม่พอ · ' : '' }}{{ s.action }}</td></tr></tbody></table></div><p class="planning-hint">Reallocation อาจย้าย subnet อื่นด้วย · IPAM/reserved IP เดิมยังคงไว้เพื่อให้ตรวจและย้าย IP ก่อนใช้งานจริง</p><button class="secondary-action" :disabled="!writable || busy" @click="applyScenario">ใช้ scenario ใน draft</button></template>
    </section>

    <section v-else-if="tab === 3" class="planning-surface">
      <div class="section-heading"><h2>IPAM / Planned addresses</h2><button class="secondary-action" :disabled="busy || !writable" @click="importTopology">นำเข้า IP จาก Topology</button></div>
      <fieldset :disabled="busy || !writable"><div class="planning-table"><table><thead><tr><th>Segment</th><th>IP</th><th>Plan</th><th>Device name</th><th>Expected MAC</th><th></th></tr></thead><tbody><tr v-for="(a, i) in form.assignments" :key="i"><td><select v-model="a.segmentId" aria-label="Assigned segment"><option v-for="s in form.segments" :key="s.id" :value="s.id">{{ s.name }}</option></select></td><td><input v-model="a.ip" placeholder="10.20.0.10" aria-label="Planned IP" /></td><td><select v-model="a.kind" aria-label="Planned role"><option>device</option><option>server</option><option>reserved</option><option>free</option></select></td><td><input v-model="a.label" aria-label="Device name" /></td><td><input v-model="a.mac" placeholder="aa:bb:cc:dd:ee:ff" aria-label="Expected MAC" /></td><td><button class="delete-button" aria-label="Remove IP assignment" @click="form.assignments.splice(i, 1)">×</button></td></tr></tbody></table></div><button class="secondary-action" @click="form.assignments.push({ segmentId: form.segments[0].id, ip: '', kind: 'server', label: '', mac: '' })">+ เพิ่ม IP</button></fieldset>
      <footer class="planning-footer"><p>IP ที่ไม่บันทึกถือเป็น unplanned · MAC ตรวจได้เฉพาะ neighbor ใน L2 ที่ Probe มองเห็น</p><button class="primary-action" :disabled="busy" @click="calculate">Validate IPAM</button></footer>
    </section>

    <section v-else class="planning-surface">
      <div class="section-heading"><h2>Planned vs Observed Network</h2><button class="quiet-button" :disabled="busy" @click="task(refresh)">Refresh</button></div>
      <p class="planning-hint">รัน Probe บน Windows/Linux ในแต่ละ segment · ผลสด 5 นาที · ไม่ตอบ ping ยังอาจเป็นเครื่องที่บล็อก ICMP · หน้าเว็บใช้แผนที่บันทึกบน Server</p>
      <p v-if="dirty" class="planning-message">มี draft ที่ยังไม่บันทึก การตรวจจริงจะเทียบกับ Plan r{{ revision }} ที่บันทึกไว้</p>
      <form v-if="role === 'owner'" class="planning-enroll" @submit.prevent="enroll"><label>Probe name<input v-model="enrollName" required placeholder="HQ VLAN 10 Probe" /></label><label>Segment<select v-model="enrollSegment" required><option disabled value="">เลือก subnet ที่บันทึกแล้ว</option><option v-for="s in design?.segments || []" :key="s.id" :value="s.id">{{ s.name }} · {{ s.cidr }}</option></select></label><button class="secondary-action" :disabled="busy || !revision">Enroll Probe</button></form>
      <div v-if="enrollment" class="planning-enrollment"><strong>Probe credential แสดงครั้งเดียว</strong><p>{{ enrollment.id }} · {{ enrollment.network }}</p><button class="primary-action" @click="downloadConfig">ดาวน์โหลด .env.probe</button><p class="planning-hint">คัดลอก scripts/probe-agent.js พร้อม src/server/lib/planning.js และ subnet.js ไปเครื่อง Probe (หรือใช้ checkout นี้) ติดตั้ง npm dependencies แล้วรัน:</p><code>node --env-file=.env.probe scripts/probe-agent.js</code><button class="quiet-button" @click="enrollment = null">ซ่อน credential</button></div>
      <div class="planning-probe-list"><div v-for="p in probes" :key="p.id"><span :class="['dot', p.online ? 'dot-green' : 'dot-amber']"></span><strong>{{ p.name }}</strong><span>{{ p.network }} · {{ p.online ? 'Online' : 'Offline / ยังไม่เชื่อมต่อ' }}</span><button v-if="role === 'owner'" class="delete-button" :disabled="busy" @click="revoke(p.id)">Revoke</button></div></div>
      <fieldset :disabled="busy || !writable || !selectedProbe"><div class="planning-job-controls"><label>Probe<select v-model="selectedProbe"><option v-for="p in probes" :key="p.id" :value="p.id">{{ p.name }}</option></select></label><label>Target IP<input v-model="target" :placeholder="selected?.network || 'IP ใน subnet'" /></label><label>Scan offset<input v-model.number="offset" type="number" min="0" step="256" /></label></div><div class="planning-actions"><button class="primary-action" @click="queue('scan')">Ping scan ≤256 IPs</button><button class="secondary-action" @click="queue('host')">Host probe</button><button class="secondary-action" @click="queue('neighbor')">ARP / Neighbor</button><button class="secondary-action" @click="queue('traceroute')">Traceroute</button><button class="secondary-action" @click="queue('netstat')">Local netstat</button></div></fieldset>
      <p class="planning-hint">Scan ใช้ offset เพื่อเลือกชุดถัดไป ไม่สแกน subnet ใหญ่ทั้งวงโดยอัตโนมัติ · Local netstat แสดง connection ของเครื่อง Probe</p>
      <div v-if="verification" class="planning-summary"><div><span>Fresh observations</span><strong>{{ verification.comparison.freshCount }}</strong></div><div><span>Stale observations</span><strong>{{ verification.comparison.staleCount }}</strong></div><div><span>Findings</span><strong>{{ verification.comparison.findings.length }}</strong></div></div>
      <ul v-if="verification?.comparison.findings.length" class="planning-issues"><li v-for="(f, i) in verification.comparison.findings" :key="i"><span>{{ f.code }}</span>{{ f.ip }} · {{ f.message }}</li></ul>
      <p v-else class="planning-hint">ยังไม่มี findings ใน IP ที่ตรวจแล้ว · ไม่ได้ยืนยันว่า IP ที่ยังไม่ตรวจว่าง</p>
      <div v-if="verification?.comparison.utilization.length" class="planning-table"><table><thead><tr><th>Segment</th><th>Observed hosts</th><th>Observed utilization (lower bound)</th></tr></thead><tbody><tr v-for="u in verification.comparison.utilization" :key="u.segmentId"><td>{{ design?.segments.find(s => s.id === u.segmentId)?.name }}</td><td>{{ u.count }}</td><td>{{ u.percent }}%</td></tr></tbody></table></div>
      <div v-if="verification?.observations.length" class="planning-table"><table><thead><tr><th>IP</th><th>Probe</th><th>ICMP</th><th>Neighbor / MAC</th><th>Latency</th><th>Received</th></tr></thead><tbody><tr v-for="o in verification.observations" :key="`${o.probeId}:${o.ip}`"><td class="mono">{{ o.ip }}</td><td>{{ o.probeName }}</td><td>{{ o.reachable ? 'Reachable' : 'No response / not pinged' }}</td><td class="mono">{{ o.mac || 'Unknown' }}<small>{{ o.neighborActive ? 'Active neighbor' : 'No active neighbor evidence' }}</small></td><td>{{ o.latencyMs == null ? '—' : `${o.latencyMs} ms` }}</td><td>{{ new Date(o.receivedAt).toLocaleTimeString() }}</td></tr></tbody></table></div>
      <h3>On-demand jobs</h3><div class="planning-job-list"><details v-for="j in verification?.jobs || []" :key="j.id"><summary>{{ j.probeName }} · {{ j.kind }} · {{ j.state }} · {{ j.coverage }} targets · Plan r{{ j.planRevision }}</summary><p v-if="j.result?.error" class="planning-danger">{{ j.result.error }}</p><pre v-if="j.result?.output">{{ j.result.output }}</pre><p v-else>ไม่มี command output · {{ j.result?.observations.length || 0 }} observations</p></details></div>
    </section>
    <div v-if="pendingExit" class="modal-backdrop" @keydown.esc.stop="pendingExit = null"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="draft-title"><h2 id="draft-title">แผนยังไม่บันทึก</h2><p>บันทึก draft ก่อนออก หรือกลับไปแก้ไขต่อ</p><p v-if="error" class="planning-danger" role="alert">{{ error }}</p><div class="modal-actions"><button class="quiet-button draft-keep" :disabled="busy" @click="pendingExit = null">แก้ไขต่อ</button><button class="quiet-button draft-discard" :disabled="busy" @click="discardAndLeave">ออกโดยไม่บันทึก</button><button class="primary-action compact draft-save" :disabled="busy" @click="saveAndLeave">บันทึกและออก</button></div></section></div>
  </main>
</template>
