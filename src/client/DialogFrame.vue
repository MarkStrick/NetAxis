<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
defineProps({ title: { type: String, required: true }, titleId: { type: String, required: true } });
const emit = defineEmits(['close']);
const panel = ref(null);
let previousFocus;
onMounted(() => { previousFocus = document.activeElement; panel.value.showModal(); });
onBeforeUnmount(() => { panel.value?.close(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); });
</script>

<template>
    <dialog ref="panel" class="modal friendly-dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId" @cancel.prevent="emit('close')">
      <div class="modal-heading"><h2 :id="titleId">{{ title }}</h2><button type="button" class="icon-button" aria-label="ปิดหน้าต่าง" @click="emit('close')">×</button></div>
      <slot />
    </dialog>
</template>
