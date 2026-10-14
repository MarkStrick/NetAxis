<script setup>
import { ref } from 'vue'
const props = defineProps({ request: Function })
const emit = defineEmits(['authenticated'])
const mode = ref('login'), email = ref(''), password = ref(''), confirmation = ref('')
const busy = ref(false), error = ref(''), visible = ref(false), fieldErrors = ref({})
const emailInput = ref(null), passwordInput = ref(null), confirmationInput = ref(null)
function changeMode(value) {
  mode.value = value; password.value = ''; confirmation.value = ''; error.value = ''; fieldErrors.value = {}
}
function validate(name) {
  let message = ''
  if (name === 'email' && (!email.value.trim() || emailInput.value?.validity.typeMismatch)) message = 'กรอกอีเมลให้ครบ เช่น name@example.com'
  if (name === 'password' && (password.value.length < 12 || password.value.length > 128)) message = 'ใช้รหัสผ่าน 12–128 ตัวอักษร'
  if (name === 'confirmation' && mode.value === 'register' && confirmation.value !== password.value) message = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'
  fieldErrors.value[name] = message
  return !message
}
function revalidate(name) { if (fieldErrors.value[name]) validate(name) }
async function submit() {
  if (busy.value) return
  error.value = ''
  const fields = mode.value === 'register' ? ['email', 'password', 'confirmation'] : ['email', 'password']
  const invalid = fields.filter(name => !validate(name))
  if (invalid.length) {
    ({ email: emailInput, password: passwordInput, confirmation: confirmationInput })[invalid[0]].value?.focus()
    return
  }
  busy.value = true
  try {
    const result = await props.request('/api/auth/' + mode.value, { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) })
    password.value = ''; confirmation.value = ''; emit('authenticated', result.user)
  } catch (failure) { error.value = failure.message || 'เชื่อมต่อไม่ได้ กรุณาลองใหม่' }
  finally { busy.value = false }
}
</script>
<template>
  <section class="account-panel" aria-labelledby="account-title">
    <p class="eyebrow">NETAXIS WORKSPACE</p>
    <h1 id="account-title">{{ mode === 'login' ? 'ยินดีต้อนรับกลับ' : 'สร้างบัญชี NetAxis' }}</h1>
    <p>เก็บงานของคุณไว้ในบัญชี และเปิดต่อได้จากทุกเครื่อง</p>
    <div class="account-tabs" role="group" aria-label="เลือกเข้าสู่ระบบหรือสมัครสมาชิก">
      <button type="button" :aria-pressed="mode === 'login'" :disabled="busy" @click="changeMode('login')">เข้าสู่ระบบ</button>
      <button type="button" :aria-pressed="mode === 'register'" :disabled="busy" @click="changeMode('register')">สมัครสมาชิก</button>
    </div>
    <form @submit.prevent="submit" :aria-busy="busy" novalidate>
      <label>อีเมล<input ref="emailInput" v-model="email" type="email" autocomplete="username" placeholder="name@example.com" required maxlength="254" :disabled="busy" :aria-invalid="Boolean(fieldErrors.email)" :aria-describedby="fieldErrors.email ? 'email-error' : undefined" @blur="validate('email')" @input="revalidate('email')" /></label>
      <p v-if="fieldErrors.email" id="email-error" class="inline-error" role="alert">{{ fieldErrors.email }}</p>
      <label>รหัสผ่าน<input ref="passwordInput" v-model="password" :type="visible ? 'text' : 'password'" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" placeholder="อย่างน้อย 12 ตัวอักษร" required minlength="12" maxlength="128" :disabled="busy" :aria-invalid="Boolean(fieldErrors.password)" :aria-describedby="fieldErrors.password ? 'password-help password-error' : 'password-help'" @blur="validate('password')" @input="revalidate('password'); revalidate('confirmation')" /></label>
      <p id="password-help" class="account-help">ใช้รหัสผ่าน 12–128 ตัวอักษร</p>
      <p v-if="fieldErrors.password" id="password-error" class="inline-error" role="alert">{{ fieldErrors.password }}</p>
      <label v-if="mode === 'register'">ยืนยันรหัสผ่าน<input ref="confirmationInput" v-model="confirmation" :type="visible ? 'text' : 'password'" autocomplete="new-password" placeholder="กรอกรหัสผ่านอีกครั้ง" required minlength="12" maxlength="128" :disabled="busy" :aria-invalid="Boolean(fieldErrors.confirmation)" :aria-describedby="fieldErrors.confirmation ? 'confirmation-error' : undefined" @blur="validate('confirmation')" @input="revalidate('confirmation')" /></label>
      <p v-if="fieldErrors.confirmation" id="confirmation-error" class="inline-error" role="alert">{{ fieldErrors.confirmation }}</p>
      <label class="account-show"><input v-model="visible" type="checkbox" :disabled="busy" /> แสดงรหัสผ่าน</label>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <button class="primary-action" :disabled="busy">{{ busy ? 'กำลังดำเนินการ…' : mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี' }}</button>
    </form>
    <p class="account-help">ห้องใหม่เป็นของบัญชีคุณ สมาชิกเข้าร่วมได้ด้วยรหัสเชิญจากเจ้าของห้อง</p>
  </section>
</template>
