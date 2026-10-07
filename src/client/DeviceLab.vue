<script setup>
import { computed, ref, watch } from 'vue'
import { deviceModels, modelFor, portsFor, resolvedPorts } from '../shared/devices.js'
const props = defineProps({ node: Object, topology: Object, writable: Boolean, participants: Array })
const emit = defineEmits(['data'])
const model = computed(() => modelFor(props.node)), ports = computed(() => portsFor(props.node)), activePort = ref('')
const port = computed(() => ports.value.find(p => p.id === activePort.value))
watch(() => props.node.id, () => { activePort.value = ''; aclError.value = '' })
function update(key, value) { if (props.writable) emit('data', { ...props.node.data, [key]: value }) }
function selectModel(id) { if (props.writable) emit('data', { ...props.node.data, model: id, ports: [] }) }
function setPort(key, value) { update('ports', [...ports.value.filter(p => p.id !== port.value.id), { ...port.value, [key]: value }]) }
function connections(id) { return resolvedPorts(props.topology).filter(e => e.sourceNodeId === props.node.id && e.sourcePort === id || e.targetNodeId === props.node.id && e.targetPort === id) }
function assign(id) { update('job', { title: props.node.data.job?.title || '', status: props.node.data.job?.status || 'todo', assignee: id, assigneeName: props.participants.find(p => p.id === id)?.displayName || '' }) }
const rule = ref({ action: 'deny', protocol: 'HTTP', source: 'any', destination: 'any', port: '' }), aclError = ref('')
function addRule() {
  const value = { ...rule.value }; delete value.port
  if (rule.value.port) { const port = Number(rule.value.port); if (!Number.isInteger(port) || port < 1 || port > 65535) { aclError.value = 'Port ต้องอยู่ระหว่าง 1–65535'; return }; value.port = port }
  aclError.value = ''; update('acl', [...(props.node.data.acl || []), value])
}
function service(key, value) { update('services', { http: props.node.type === 'server', tcpPorts: [], udpPorts: [], ...props.node.data.services, [key]: value }) }
</script>
<template>
  <section class="device-lab">
    <label>Device model<select :value="model.id" :disabled="!writable" @change="selectModel($event.target.value)"><option v-for="m in deviceModels.filter(m => m.type === node.type)" :key="m.id" :value="m.id">{{ m.name }}</option></select></label>
    <p class="lab-spec">Layer {{ model.layer }} · {{ model.count }} ports · รุ่นจำลองสำหรับ Lab</p>
    <details open><summary>Ports · กดพอร์ตเพื่อดูและตั้งค่า</summary>
      <div class="port-grid"><button v-for="p in ports" :key="p.id" :class="{ occupied: connections(p.id).length, active: activePort === p.id, down: p.status === 'down' }" @click="activePort = p.id" :aria-pressed="activePort === p.id" :title="`${p.id} · ${p.mode} · VLAN ${p.vlan}`">{{ p.id }}<small>{{ connections(p.id).length ? '● connected' : '○ free' }}</small></button></div>
      <div v-if="port" class="port-config"><strong>{{ port.id }}</strong><p v-for="link in connections(port.id)" :key="link.id">{{ topology.nodes.find(n => n.id === (link.sourceNodeId === node.id ? link.targetNodeId : link.sourceNodeId))?.label }} · {{ link.sourceNodeId === node.id ? link.targetPort : link.sourcePort }}</p>
        <label>Port status<select :value="port.status" :disabled="!writable" @change="setPort('status', $event.target.value)"><option value="up">Up</option><option value="down">Down</option></select></label>
        <label>Mode<select :value="port.mode" :disabled="!writable" @change="setPort('mode', $event.target.value)"><option value="access">Access</option><option value="trunk">Trunk (tagged)</option></select></label>
        <label v-if="port.mode === 'access'">Access VLAN<input type="number" min="1" max="4094" :value="port.vlan" :disabled="!writable" @change="setPort('vlan', Number($event.target.value))" /></label>
        <label v-else>Allowed VLANs<input :value="port.allowedVlans.join(',')" :disabled="!writable" placeholder="1,10,20" @change="setPort('allowedVlans', $event.target.value.split(',').map(v => Number(v.trim())))" /></label>
        <template v-if="model.layer === 3"><label>Interface IPv4<input :value="port.ipv4 || ''" :disabled="!writable" @change="setPort('ipv4', $event.target.value)" /></label><label>Interface CIDR<input type="number" min="0" max="32" :value="port.cidr ?? 24" :disabled="!writable" @change="setPort('cidr', Number($event.target.value))" /></label></template>
      </div>
    </details>
    <label>Default gateway<input :value="node.data.gateway || ''" :disabled="!writable" placeholder="เว้นว่างเพื่อให้ Lab อนุมาน gateway" @change="update('gateway', $event.target.value)" /></label>
    <details><summary>Firewall / ACL · {{ node.data.acl?.length || 0 }} rules</summary><p>ตรวจตามลำดับบนอุปกรณ์นี้ทั้งขาไปและกลับ (stateless)</p>
      <label>Default action<select :value="node.data.aclDefault || 'allow'" :disabled="!writable" @change="update('aclDefault', $event.target.value)"><option value="allow">Allow</option><option value="deny">Deny</option></select></label>
      <ol class="acl-list"><li v-for="(r, i) in node.data.acl || []" :key="i"><span>{{ r.action.toUpperCase() }} {{ r.protocol }} {{ r.source }} → {{ r.destination }} {{ r.port ? ':' + r.port : '' }}</span><button :disabled="!writable || i === 0" aria-label="Move ACL rule up" @click="update('acl', node.data.acl.toSpliced(i - 1, 2, r, node.data.acl[i - 1]))">↑</button><button :disabled="!writable" aria-label="Remove ACL rule" @click="update('acl', node.data.acl.filter((_, index) => index !== i))">×</button></li></ol>
      <fieldset :disabled="!writable"><div class="field-row"><label>Action<select v-model="rule.action"><option value="deny">Deny</option><option value="allow">Allow</option></select></label><label>Protocol<select v-model="rule.protocol"><option v-for="p in ['ANY','ICMP','TCP','UDP','HTTP']" :key="p">{{ p }}</option></select></label></div><label>Source IP/CIDR<input v-model="rule.source" placeholder="any / 10.0.0.0/24" /></label><label>Destination IP/CIDR<input v-model="rule.destination" placeholder="any" /></label><label>Destination port (optional)<input v-model="rule.port" type="number" min="1" max="65535" /></label><button class="utility-action" @click="addRule">+ เพิ่ม ACL rule</button></fieldset><p v-if="aclError" role="alert">{{ aclError }}</p>
    </details>
    <details v-if="['pc','server'].includes(node.type)"><summary>Services</summary><label class="check-label"><input type="checkbox" :checked="node.data.services?.http ?? node.type === 'server'" :disabled="!writable" @change="service('http', $event.target.checked)" /> HTTP server · port 80</label><label>TCP listening ports<input :value="node.data.services?.tcpPorts.join(',') || ''" :disabled="!writable" placeholder="443,22" @change="service('tcpPorts', $event.target.value.split(',').filter(v => v.trim()).map(Number))" /></label><label>UDP listening ports<input :value="node.data.services?.udpPorts.join(',') || ''" :disabled="!writable" placeholder="53" @change="service('udpPorts', $event.target.value.split(',').filter(v => v.trim()).map(Number))" /></label></details>
    <details><summary>Assign job · {{ node.data.job?.assigneeName || 'ยังไม่มอบหมาย' }}</summary><label>งานที่ต้องทำ<input :value="node.data.job?.title || ''" maxlength="200" :disabled="!writable" @change="update('job', { assignee: '', assigneeName: '', status: 'todo', ...node.data.job, title: $event.target.value })" /></label><label>ผู้รับผิดชอบ<select :value="node.data.job?.assignee || ''" :disabled="!writable" @change="assign($event.target.value)"><option value="">ยังไม่มอบหมาย</option><option v-if="node.data.job?.assignee && !participants.some(p => p.id === node.data.job.assignee)" :value="node.data.job.assignee">{{ node.data.job.assigneeName }} (ไม่อยู่ในห้อง)</option><option v-for="p in participants" :key="p.id" :value="p.id">{{ p.displayName }}</option></select></label><label>สถานะงาน<select :value="node.data.job?.status || 'todo'" :disabled="!writable" @change="update('job', { title: '', assignee: '', assigneeName: '', ...node.data.job, status: $event.target.value })"><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option></select></label></details>
  </section>
</template>
