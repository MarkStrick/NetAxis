<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
defineProps({ title: { type: String, required: true }, titleId: { type: String, required: true } });
const emit = defineEmits(['close']);
const panel = ref(null);
onMounted(() => panel.value.showModal());
onBeforeUnmount(() => panel.value.close());
</script>

<template>
    <dialog ref="panel" class="modal friendly-dialog" :aria-labelledby="titleId" @cancel.prevent="emit('close')">
      <div class="modal-heading"><h2 :id="titleId">{{ title }}</h2><button type="button" class="icon-button" aria-label="ปิดหน้าต่าง" @click="emit('close')">×</button></div>
      <slot />
    </dialog>
</template>
