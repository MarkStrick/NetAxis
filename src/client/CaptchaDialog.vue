<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue';
import DialogFrame from './DialogFrame.vue';
const props = defineProps({ request: { type: Function, required: true }, verify: { type: Function, required: true } });
const emit = defineEmits(['verified', 'close']);
const challenge = ref(null), answer = ref(''), busy = ref(false), error = ref(''), clock = ref(Date.now()), submitting = ref(false);
const answerInput = ref(null);
let timer;
function close() { if (!submitting.value) emit('close'); }
const expired = computed(() => challenge.value && clock.value >= challenge.value.expiresAt);
async function refresh() {
  busy.value = true; challenge.value = null; answer.value = '';
  try { challenge.value = await props.request('/api/captcha'); clock.value = Date.now(); }
  catch (failure) { error.value = failure.message; }
  finally { busy.value = false; await nextTick(); if (!submitting.value) answerInput.value?.focus(); }
}
async function submit() {
  if (busy.value || submitting.value || expired.value || !/^\d{6}$/.test(answer.value)) return;
  submitting.value = true; error.value = '';
  try { await props.verify({ id: challenge.value.id, answer: answer.value }); emit('verified'); }
  catch (failure) { error.value = failure.message; await refresh(); }
  finally { submitting.value = false; }
}
onMounted(() => { refresh(); timer = setInterval(() => { clock.value = Date.now(); }, 1000); });
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <DialogFrame title="ยืนยันเมื่อเข้าเว็บครั้งแรก" title-id="captcha-title" @close="close">
    <p class="friendly-copy">กรอกตัวเลข 6 หลักจากภาพเพียงครั้งเดียว เบราว์เซอร์นี้จะจำการยืนยันไว้ ให้คุณสร้างและเข้าร่วมห้องต่อได้ทันที</p>
    <form class="captcha-form" @submit.prevent="submit">
      <div class="captcha-image-row">
        <img v-if="challenge" :src="challenge.image" width="240" height="72" alt="ภาพรหัสยืนยัน 6 หลัก" />
        <span v-else role="status">กำลังโหลดภาพ…</span>
        <button class="quiet-button" type="button" :disabled="busy || submitting" @click="error = ''; refresh()">เปลี่ยนภาพ ↻</button>
      </div>
      <label>รหัสจากภาพ<input ref="answerInput" v-model="answer" aria-label="รหัสจากภาพ" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" :disabled="busy || submitting" placeholder="ตัวเลข 6 หลัก" /></label>
      <p v-if="expired" class="inline-error" role="alert">ภาพหมดอายุแล้ว กดเปลี่ยนภาพเพื่อรับรหัสใหม่</p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <p class="friendly-copy">อ่านไม่ชัด? กดเปลี่ยนภาพ · รหัสใช้ได้ครั้งเดียวภายใน 5 นาที</p>
      <div class="modal-actions"><button type="button" class="quiet-button" :disabled="submitting" @click="emit('close')">ไว้ก่อน</button><button type="submit" class="primary-action compact" :disabled="!challenge || busy || submitting || expired || !/^\d{6}$/.test(answer)">{{ submitting ? 'กำลังตรวจสอบ…' : 'ยืนยันและเริ่มใช้งาน' }}</button></div>
    </form>
  </DialogFrame>
</template>
