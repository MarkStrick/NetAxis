<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import RoomVoice from './RoomVoice.vue';
const props = defineProps({ open: Boolean, participants: { type: Array, default: () => [] }, participant: Object, messages: { type: Array, default: () => [] }, request: Function, roomId: String, connectionState: String, collaboration: Object, sendCollaboration: Function, jobs: { type: Array, default: () => [] } });
const emit = defineEmits(['close', 'message', 'status']);
const tab = ref('chat'), draft = ref(''), sending = ref(false), error = ref(''), statusBusy = ref(false), log = ref(null), composer = ref(null);
const status = ref(props.participants.find(m => m.id === props.participant.id)?.status || 'online');
const statuses = { online: 'พร้อมใช้งาน', away: 'ไม่อยู่', busy: 'ไม่ว่าง', offline: 'ออฟไลน์' };
const roles = { owner: 'เจ้าของห้อง', editor: 'แก้ไขได้', viewer: 'ดูอย่างเดียว' };
const online = computed(() => props.participants.filter(m => m.connected).length);
const sortedMembers = computed(() => [...props.participants].sort((a, b) => Number(b.connected) - Number(a.connected)));
let attempt = null;
let active = true;
onBeforeUnmount(() => { active = false; });
function enter(event) { if (!event.isComposing) { event.preventDefault(); send(); } }
const clientId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
async function send() {
  const text = draft.value.trim(); if (!text || sending.value || props.connectionState !== 'connected') return;
  sending.value = true; error.value = '';
  if (!attempt || attempt.text !== text) attempt = { text, clientId: clientId() };
  try {
    const result = await props.request(`/api/rooms/${props.roomId}/messages`, { method: 'POST', body: JSON.stringify(attempt) });
    if (!active) return;
    emit('message', result.message); draft.value = ''; attempt = null;
    await nextTick(); if (log.value) log.value.scrollTop = log.value.scrollHeight;
  } catch (failure) { error.value = failure.message; }
  finally { sending.value = false; await nextTick(); composer.value?.focus(); }
}
async function changeStatus(event) {
  const value = event.target.value; statusBusy.value = true; error.value = '';
  try { const result = await props.request(`/api/rooms/${props.roomId}/member-status`, { method: 'PATCH', body: JSON.stringify({ status: value }) }); if (!active) return; status.value = value; emit('status', result); }
  catch (failure) { error.value = failure.message; event.target.value = status.value; }
  finally { statusBusy.value = false; }
}
const timeLabel = value => new Date(value).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
watch(() => props.messages.length, async () => {
  const atBottom = !log.value || log.value.scrollHeight - log.value.scrollTop - log.value.clientHeight < 80;
  await nextTick(); if (atBottom && log.value) log.value.scrollTop = log.value.scrollHeight;
});
watch(() => props.participants.find(m => m.id === props.participant.id)?.status, value => { if (value && value !== 'offline') status.value = value; });
watch(tab, async value => { await nextTick(); if (value === 'chat' && log.value) log.value.scrollTop = log.value.scrollHeight; });
async function focusComposer() { await nextTick(); if (props.open) { composer.value?.focus(); if (log.value) log.value.scrollTop = log.value.scrollHeight; } }
watch(() => props.open, focusComposer);
onMounted(focusComposer);
</script>

<template>
  <aside class="community-panel" aria-labelledby="community-title" @keydown.esc.stop="emit('close')">
    <div class="community-heading"><div><p class="eyebrow">ROOM COMMUNITY</p><h2 id="community-title">แชทและสมาชิก</h2><small>{{ online }} ออนไลน์ · {{ participants.length }} สมาชิก</small></div><button class="icon-button" aria-label="ปิดแชทและสมาชิก" @click="emit('close')">×</button></div>
    <div class="community-tabs" aria-label="เมนูแชทและสมาชิก"><button :aria-pressed="tab === 'chat'" @click="tab = 'chat'">แชทในห้อง</button><button :aria-pressed="tab === 'members'" @click="tab = 'members'">สมาชิก ({{ participants.length }})</button></div>
    <RoomVoice v-if="sendCollaboration" :state="collaboration" :participant="participant" :send="sendCollaboration" :connection-state="connectionState" />
    <details class="voice-controls"><summary>งานที่มอบหมาย · {{ jobs.length }}</summary><p v-if="!jobs.length">เลือกอุปกรณ์บน Canvas แล้วเปิด Assign job</p><p v-for="n in jobs" :key="n.id">{{ n.data.job.status === 'done' ? '✓' : '☐' }} {{ n.label }} · {{ n.data.job.title }} · {{ n.data.job.assigneeName || 'Unassigned' }} · {{ n.data.job.status }}</p></details>
    <template v-if="tab === 'chat'">
      <p class="community-note">ทุกคนในห้องส่งข้อความได้ · เก็บล่าสุด 100 ข้อความ</p>
      <div ref="log" class="chat-log" role="log" aria-label="ข้อความในห้อง" aria-live="polite" aria-relevant="additions" tabindex="0">
        <div v-if="!messages.length" class="community-empty"><strong>เริ่มบทสนทนากับทีม</strong><p>ส่งคำถามหรือแบ่งปันสิ่งที่กำลังทำในห้องนี้</p></div>
        <article v-for="message in messages" :key="message.id" class="chat-message" :class="{ 'chat-own': message.participantId === participant.id }"><div class="chat-meta"><strong>{{ message.displayName }}{{ message.participantId === participant.id ? ' (คุณ)' : '' }}</strong><span>{{ roles[message.role] }}</span><time :datetime="message.createdAt" :title="new Date(message.createdAt).toLocaleString('th-TH')">{{ timeLabel(message.createdAt) }}</time></div><p>{{ message.text }}</p></article>
      </div>
      <form class="chat-composer" @submit.prevent="send"><label class="sr-only" for="room-chat-message">ข้อความแชท</label><textarea id="room-chat-message" ref="composer" v-model="draft" maxlength="1000" rows="3" placeholder="พิมพ์ข้อความถึงทีม…" :disabled="sending" @keydown.enter.exact="enter"></textarea><div><small>{{ draft.length }}/1000 · Shift+Enter ขึ้นบรรทัดใหม่</small><button type="submit" class="primary-action compact" :disabled="!draft.trim() || sending || connectionState !== 'connected'">{{ sending ? 'กำลังส่ง…' : 'ส่ง →' }}</button></div></form>
      <p v-if="connectionState !== 'connected'" class="inline-error" role="status">กำลังรอการเชื่อมต่อ ข้อความที่พิมพ์ไว้ยังอยู่</p>
    </template>
    <template v-else><label class="member-status-control">สถานะของคุณ<select aria-label="สถานะของคุณ" :value="status === 'offline' ? 'online' : status" :disabled="statusBusy || connectionState !== 'connected'" @change="changeStatus"><option value="online">พร้อมใช้งาน</option><option value="away">ไม่อยู่</option><option value="busy">ไม่ว่าง</option></select></label><ul class="member-list"><li v-for="person in sortedMembers" :key="person.id"><span class="member-avatar">{{ person.displayName.slice(0, 1).toUpperCase() }}</span><div><strong>{{ person.displayName }}{{ person.id === participant.id ? ' (คุณ)' : '' }}</strong><small>{{ roles[person.role] || person.role }}</small></div><span class="member-status" :data-status="person.connected ? (person.status || 'online') : 'offline'"><i></i>{{ statuses[person.connected ? (person.status || 'online') : 'offline'] }}</span></li></ul></template>
    <p v-if="error" class="inline-error community-error" role="alert">{{ error }}</p>
  </aside>
</template>
