<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { supportsCiscoCli, portsFor } from '../shared/devices.js';
import DialogFrame from './DialogFrame.vue';
import { clone } from './lib/topology.js';
const props = defineProps({ topology:Object, writable:Boolean, save:Function, initialNodeId:String });
const emit = defineEmits(['close','simulate']);
const devices = computed(() => props.topology.nodes.filter(supportsCiscoCli));
const selected = ref(devices.value.some(n => n.id === props.initialNodeId) ? props.initialNodeId : devices.value[0]?.id || ''), command = ref(''), output = ref(''), prompt = ref(''), draft = ref(null), busy = ref(false), ready = ref(false), changed = ref(false), error = ref(''), confirmClose = ref('');
const examplePort = computed(() => { const node = devices.value.find(n => n.id === selected.value); return node ? portsFor(node)[0].id : 'G0/0'; });
const terminal = ref(null), field = ref(null), history = []; let historyIndex = 0, worker, sequence = 0, disposed = false, loadedKey = '';
const requests = new Map();
const key = () => JSON.stringify({nodes:props.topology.nodes.map(n => [n.id,n.type,n.label,n.data]),edges:props.topology.edges});
function ask(action, extra={}) {
  const id = ++sequence;
  return new Promise((resolve,reject) => { const timer = setTimeout(() => { requests.delete(id); reject(new Error('Simulator ใช้เวลานานเกินไป กรุณาโหลดใหม่')); },10000); requests.set(id,{resolve,reject,timer}); worker.postMessage({id,action,...extra}); });
}
async function load() {
  if (disposed) return;
  error.value = ''; ready.value = false; busy.value = true; const sourceKey = key();
  try { const initialized = await ask('init',{graph:clone(props.topology)}); loadedKey = sourceKey; changed.value = false; draft.value = null; output.value = `Cisco Real Sim · browser simulation\nพิมพ์ enable, configure terminal, interface ${examplePort.value} หรือ ? เพื่อเริ่ม\n`; prompt.value = initialized.prompts[selected.value] || ''; ready.value = true; }
  catch (e) { error.value = e.message; }
  finally { busy.value = false; if (!disposed && ready.value && key() !== loadedKey) load(); }
}
async function append(text) { output.value = (output.value + text).slice(-40000); await nextTick(); if (terminal.value) terminal.value.scrollTop = terminal.value.scrollHeight; }
async function send() {
  if (!ready.value || busy.value || changed.value || !selected.value) return;
  const input = command.value; command.value = ''; if (input.trim()) { history.push(input); historyIndex = history.length; }
  busy.value = true; error.value = '';
  try { await append(`${prompt.value}${input}\n`); const result = await ask('command',{nodeId:selected.value,input,writable:props.writable}); prompt.value = result.prompt; if (result.dirty) draft.value = result.node; await append(result.output ? result.output + '\n' : ''); }
  catch (e) { error.value = e.message; }
  finally { busy.value = false; if (key() !== loadedKey) { if (draft.value) changed.value=true; else load(); } await nextTick(); field.value?.focus(); }
}
async function complete() {
  if (!ready.value || busy.value || changed.value) return;
  const result = await ask('complete',{nodeId:selected.value,input:command.value}).catch(e => { error.value=e.message; return {}; });
  if (result.completions?.length === 1) command.value = result.completions[0];
  else if (result.completions?.length) await append(result.completions.join('  ')+'\n');
}
function previous(direction) { historyIndex = Math.max(0,Math.min(history.length,historyIndex+direction)); command.value = history[historyIndex] || ''; }
async function save() {
  if (!draft.value || busy.value || !props.writable || changed.value) return;
  if (key() !== loadedKey) { changed.value=true; return; }
  busy.value = true; error.value = '';
  try { const node = clone(draft.value); if (!await props.save(node)) throw new Error('บันทึกไม่สำเร็จ ตรวจสถานะการเชื่อมต่อและ revision ของห้อง'); await ask('saved',{nodeId:node.id}); loadedKey=key(); changed.value=false; draft.value=null; await append('บันทึก Config ลงโปรเจกต์แล้ว\n'); }
  catch(e) { error.value=e.message; }
  finally { busy.value=false; }
}
function close() { if (draft.value) confirmClose.value='close'; else emit('close'); }
function discard() { const action=confirmClose.value; confirmClose.value=''; if(action==='reload') load(); else emit('close'); }
watch(selected, async () => { command.value=''; if (ready.value) { const result=await ask('command',{nodeId:selected.value,input:'',writable:props.writable}).catch(()=>null); if(result) prompt.value=result.prompt; } });
watch(key, value => {
  if (value === loadedKey || busy.value) return;
  if (draft.value) changed.value=true;
  else load();
});
onMounted(() => {
  worker = new Worker(new URL('./lib/cisco-worker.js',import.meta.url),{type:'module'});
  worker.onmessage = ({data}) => { const request=requests.get(data.id); if(!request) return; requests.delete(data.id); clearTimeout(request.timer); if(data.error) request.reject(new Error(data.error)); else request.resolve(data); };
  worker.onerror = () => { ready.value=false; error.value='โหลด Cisco Engine ไม่สำเร็จ'; for(const r of requests.values()) { clearTimeout(r.timer); r.reject(new Error('Worker stopped')); } requests.clear(); };
  load();
});
onBeforeUnmount(() => { disposed=true; worker?.terminate(); for(const r of requests.values()) { clearTimeout(r.timer); r.reject(new Error('Cisco Lab closed')); } requests.clear(); });
</script>

<template>
  <DialogFrame title="Cisco CLI Lab" title-id="cisco-lab-title" @close="close">
    <div class="cisco-lab">
      <p class="cisco-subtitle">คอนโซลอุปกรณ์ · Enter ส่งคำสั่ง · Tab เติมคำ</p><p class="cisco-save-help">บันทึก Config ก่อน เพื่อให้ Scenario ใช้ค่าที่แก้ไข</p>
      <p v-if="!devices.length">เพิ่ม Router / Switch รุ่น Cisco หรือ Lab preset ก่อนเปิด CLI</p>
      <label>อุปกรณ์<select v-model="selected" :disabled="busy || Boolean(draft)"><option v-for="node in devices" :key="node.id" :value="node.id">{{ node.label }}</option></select></label>
      <p v-if="!writable">Viewer ใช้ show / ping ได้ แต่แก้หรือบันทึก Config ไม่ได้</p>
      <p v-if="changed" role="alert" class="inline-error">Topology เปลี่ยนระหว่างแก้ Config กรุณาโหลดใหม่เพื่อไม่เขียนทับงานของสมาชิกอื่น (Draft นี้จะถูกทิ้ง)</p>
      <p v-if="error" role="alert" class="inline-error">{{ error }}</p>
      <div class="cisco-console-layout"><aside class="cisco-reference"><h3>คำสั่งที่ใช้บ่อย</h3><p>เริ่มด้วย enable แล้วเลือกคำสั่งเพื่อใส่ในช่องด้านล่าง</p><button v-for="example in ['enable', 'configure terminal', 'show ip interface brief', 'show ip route', 'show running-config', 'end']" :key="example" :disabled="busy || !ready || changed || !selected" @click="command = example; field?.focus()"><code>{{ example }}</code></button><details><summary>ตั้งค่า IP</summary><code>enable<br />configure terminal<br />interface {{ examplePort }}<br />ip address 10.0.0.1 255.255.255.0<br />no shutdown<br />end</code></details></aside><div class="cisco-console"><pre ref="terminal" class="cisco-output" tabindex="0" aria-label="ผลลัพธ์ Cisco CLI">{{ output }}</pre>
      <form class="cisco-command" @submit.prevent="send"><span>{{ prompt }}</span><input ref="field" v-model="command" aria-label="คำสั่ง Cisco" maxlength="512" autocomplete="off" spellcheck="false" :disabled="busy || !ready || changed || !selected" @keydown.up.prevent="previous(-1)" @keydown.down.prevent="previous(1)" @keydown.tab.prevent="complete" /><button class="secondary-action" :disabled="busy || !ready || changed || !selected">ส่ง</button></form></div></div>
      <div class="cisco-actions"><button class="primary-action" :disabled="!draft || busy || changed || !writable" @click="save">บันทึก Config ลงโปรเจกต์</button><button class="secondary-action" :disabled="busy" @click="draft ? confirmClose = 'reload' : load()">โหลด Config ใหม่</button><button class="secondary-action" :disabled="Boolean(draft) || busy || changed" @click="emit('simulate')">เปิดหน้าทดสอบ →</button><span v-if="draft">มี Config ที่ยังไม่บันทึก</span><span v-else>Config ตรงกับโปรเจกต์</span></div>
      <details class="cisco-support"><summary>ขอบเขตการจำลอง</summary><p>รองรับ Interface/IP, shutdown, VLAN, Static Route และ show/ping ยังไม่ครบทุกคำสั่งของ Cisco IOS</p></details>
      <div v-if="confirmClose" class="cisco-confirm"><p>มี Draft ที่ยังไม่บันทึก จะทิ้งการแก้ไขนี้หรือไม่?</p><button class="delete-button" @click="discard">{{ confirmClose === 'reload' ? 'ทิ้ง Draft และโหลดใหม่' : 'ทิ้ง Draft และปิด' }}</button><button class="secondary-action" @click="confirmClose=''">กลับไปแก้ไข</button></div>
    </div>
  </DialogFrame>
</template>
