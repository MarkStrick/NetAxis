<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import DialogFrame from './DialogFrame.vue'
import DeviceGraphic from './DeviceGraphic.vue'
const props = defineProps({ type:String, category:String, load:Function, add:Function, writable:Boolean })
const emit = defineEmits(['close'])
const models = ref([]), loading = ref(true), error = ref(''), query = ref(''), showLab = ref(false), selectedId = ref(''), label = ref(''), saving = ref(false)
const filtered = computed(() => models.value.filter(m => m.type === props.type && (showLab.value || m.brand) && `${m.brand || 'Lab'} ${m.name}`.toLowerCase().includes(query.value.trim().toLowerCase())).sort((a,b) => Number(!a.brand)-Number(!b.brand) || `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`)))
const selected = computed(() => filtered.value.find(m => m.id === selectedId.value))
watch(selected, model => { label.value = model ? `${model.brand || ''} ${model.name}`.trim() : '' })
async function loadCatalog() {
  loading.value = true; error.value = ''
  try { const catalog = await props.load(); if (!Array.isArray(catalog.models)) throw new Error('Invalid catalog'); models.value = catalog.models }
  catch { error.value = 'โหลดรายการรุ่นไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่' }
  finally { loading.value = false }
}
async function submit() {
  if (!selected.value || !label.value.trim() || !props.writable || saving.value) return
  saving.value = true; error.value = ''
  try { if (await props.add(selected.value, label.value.trim())) emit('close'); else error.value = 'เพิ่มอุปกรณ์ไม่สำเร็จ กรุณาลองอีกครั้ง หรือปิดหน้าต่างเพื่อตรวจข้อความด้านบน' }
  catch { error.value = 'เพิ่มอุปกรณ์ไม่สำเร็จ กรุณาลองอีกครั้ง' }
  finally { saving.value = false }
}
onMounted(loadCatalog)
</script>
<template>
  <DialogFrame :title="`เพิ่ม ${category} · เลือกรุ่น`" title-id="device-picker-title" @close="!saving && emit('close')">
    <form class="device-picker" @submit.prevent="submit" :aria-busy="loading || saving">
      <p class="picker-intro">เลือกรุ่นเพื่อดูสเปก แล้วกดเพิ่มลงผัง</p>
      <p v-if="loading" role="status">กำลังโหลดรุ่นอุปกรณ์…</p>
      <div v-else class="picker-layout">
        <section class="picker-catalog" aria-label="รายการรุ่นอุปกรณ์">
          <label class="picker-search">ค้นหายี่ห้อหรือรุ่น<input v-model="query" type="search" placeholder="เช่น Cisco, Catalyst" :disabled="saving" /></label>
          <label class="picker-lab"><input v-model="showLab" type="checkbox" :disabled="saving" /> แสดงรุ่น Lab จำลองด้วย</label>
          <fieldset class="model-list" :disabled="saving"><legend>{{ filtered.length }} รุ่น · เลือกได้ 1 รุ่น</legend>
            <label v-for="model in filtered" :key="model.id" class="model-choice" :class="{chosen:selectedId === model.id}">
              <input v-model="selectedId" type="radio" name="device-model" :value="model.id" />
              <span><small>{{ model.brand || 'Lab preset' }}</small><strong>{{ model.name }}</strong><small>{{ model.physicalPortCount ?? model.count }} {{ model.logical ? 'physical ports · Logical' : 'พอร์ตจริง' }} · L{{ model.layer }}</small></span>
            </label>
          </fieldset>
          <p v-if="!filtered.length && !error">ไม่พบรุ่นที่ตรงกับคำค้น <button type="button" class="quiet-button" @click="query = ''; showLab = true">แสดงทุกรุ่น</button></p>
        </section>
        <section class="picker-spec" aria-label="สเปกรุ่นที่เลือก" aria-live="polite">
          <template v-if="selected">
            <DeviceGraphic :type="type" width="88" height="54" />
            <p>{{ selected.brand || 'Lab preset' }}</p><h3>{{ selected.name }}</h3>
            <ul><li v-for="spec in selected.specs || [`Layer ${selected.layer} · ${selected.count} พอร์ตจำลอง`]" :key="spec">{{ spec }}</li></ul>
            <p class="picker-scope">{{ selected.ciscoCli === true ? 'ใช้ Cisco CLI จำลองและ Scenario ได้' : selected.brand ? 'ใช้ Scenario มาตรฐาน IPv4; ไม่รัน firmware ของผู้ผลิต' : 'โปรไฟล์สำหรับฝึกเครือข่าย ไม่ใช่สเปกฮาร์ดแวร์' }} · ความเร็ว / PoE เป็นข้อมูลสเปก ไม่ได้จำลอง throughput หรือไฟฟ้า</p>
            <a v-if="selected.source" :href="selected.source" target="_blank" rel="noopener noreferrer">ดูสเปกจากผู้ผลิต ↗</a>
            <label class="picker-name">ชื่อที่แสดงบนผัง<input v-model="label" required maxlength="120" :disabled="saving" /></label>
          </template>
          <p v-else class="picker-empty">เลือกการ์ดรุ่นทางซ้ายเพื่อดูสเปก</p>
        </section>
      </div>
      <p v-if="error" class="inline-error" role="alert">{{ error }} <button v-if="!models.length && !loading" type="button" class="quiet-button" @click="loadCatalog">ลองโหลดใหม่</button></p>
      <footer class="picker-footer"><span>{{ !writable ? 'คุณมีสิทธิ์ดูอย่างเดียว' : !selected ? 'เลือกรุ่นก่อนเพิ่ม' : `${label || selected.name} · ${selected.count} จุดเชื่อมใน Lab` }}</span><button type="button" class="secondary-action" :disabled="saving" @click="emit('close')">ยกเลิก</button><button class="primary-action" :disabled="loading || saving || !selected || !label.trim() || !writable">{{ saving ? 'กำลังเพิ่ม…' : 'เพิ่มลงผัง' }}</button></footer>
    </form>
  </DialogFrame>
</template>
<style>
.friendly-dialog:has(.device-picker){width:min(880px,calc(100vw - 24px));max-height:calc(100dvh - 32px);overflow:hidden;color-scheme:light;display:flex;flex-direction:column;max-width:calc(100vw - 24px)}
.device-picker{font-size:16px;line-height:1.5;display:flex;flex-direction:column;min-height:0;overflow:hidden}.picker-intro{margin:0 0 20px;flex-shrink:0}.picker-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;min-height:0;overflow:auto}.picker-catalog,.picker-spec{min-width:0}.picker-search,.picker-name{display:grid;gap:6px}.picker-search input,.picker-name input{width:100%;min-height:44px;font-size:16px}.picker-lab{display:flex;align-items:center;gap:8px;min-height:44px;margin:8px 0}.picker-lab input,.model-choice input{width:18px;height:18px;flex-shrink:0}.model-list{border:0;padding:0;margin:0;max-height:350px;overflow:auto}.model-list legend{font-size:13px;padding:0 0 10px;color:var(--muted)}.model-choice{display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:6px;padding:12px;margin:0 2px 8px;cursor:pointer;min-height:80px}.model-choice.chosen{border-color:var(--blue);background:#f0f5ff}.model-choice:focus-within{outline:2px solid var(--blue);outline-offset:2px}.model-choice span{display:grid;gap:3px;overflow-wrap:anywhere}.model-choice strong{color:var(--text);font-size:15px;font-weight:600}.model-choice small{color:var(--muted);font-size:12px}.picker-spec{border-left:1px solid var(--line);padding-left:24px}.picker-spec h3{font-size:22px;margin:0 0 16px;overflow-wrap:anywhere}.picker-spec p{margin:8px 0}.picker-spec ul{padding-left:20px}.picker-scope{font-size:13px;line-height:1.65}.picker-spec a{display:inline-block;margin:4px 0 20px;color:#2456b8;text-decoration:underline}.picker-empty{padding-top:48px}.picker-footer{flex-shrink:0;display:flex;gap:10px;align-items:center;border-top:1px solid var(--line);margin-top:24px;padding-top:16px}.picker-footer span{flex:1;font-size:13px;overflow-wrap:anywhere}.device-picker .picker-footer button{width:auto;flex:0 0 auto;min-height:44px;white-space:nowrap;padding:10px 16px}.picker-name{margin-top:12px}
@media(max-width:600px){.picker-layout{grid-template-columns:minmax(0,1fr);gap:16px}.model-list{max-height:220px}.picker-spec{border-left:0;border-top:1px solid var(--line);padding:16px 0 0}.picker-spec:has(.picker-empty){display:none}.picker-spec>svg{display:none}.picker-footer{flex-wrap:wrap}.picker-footer span{flex-basis:100%}.device-picker .picker-footer button{flex:1}.friendly-dialog:has(.device-picker){padding:16px}.friendly-dialog:has(.device-picker) .modal-heading{flex-shrink:0}.device-picker{font-size:16px}}
</style>
