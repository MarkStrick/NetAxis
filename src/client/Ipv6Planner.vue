<script setup>
import { computed } from 'vue'
import { planIpv6 } from '../shared/ipv6.js'
const props = defineProps({ value: Object, writable: { type: Boolean, default: true } })
const emit = defineEmits(['update'])
const form = computed(() => props.value || { parent: '2001:db8::/48', prefix: 64, count: 3 })
function change(key, value) { emit('update', { ...form.value, [key]: value }) }
const result = computed(() => { try { return planIpv6(form.value.parent, Number(form.value.prefix), Number(form.value.count)) } catch (error) { return { error: error.message } } })
</script>
<template>
  <section class="ipv6-planner"><h3>IPv6 Subnet Planning</h3><p>แบ่ง LAN เป็น /64 โดยทั่วไป · IPv6 ไม่มี Broadcast และไม่หัก 2 ที่อยู่แบบ IPv4</p><fieldset :disabled="!writable"><label>IPv6 parent network<input :value="form.parent" placeholder="2001:db8::/48" @input="change('parent', $event.target.value)" /></label><div class="field-row"><label>Subnet prefix<input :value="form.prefix" type="number" min="0" max="128" @input="change('prefix', Number($event.target.value))" /></label><label>จำนวน Subnet<input :value="form.count" type="number" min="1" max="100" @input="change('count', Number($event.target.value))" /></label></div></fieldset><p v-if="result.error" role="alert" class="inline-error">{{ result.error }}</p><template v-else><p>{{ result.network }} · รองรับ {{ result.capacity }} subnets · {{ result.addressesPerSubnet }} addresses/subnet</p><p v-if="form.prefix !== 64">Prefix นี้ใช้ได้กับการคำนวณ แต่ SLAAC ของ LAN ปกติต้องใช้ /64</p><div class="ipv6-results"><div v-for="s in result.subnets" :key="s.cidr"><strong>{{ s.cidr }}</strong><small>Gateway suggestion: {{ s.gateway }}<br />{{ s.first }} → {{ s.last }}</small></div></div></template></section>
</template>
