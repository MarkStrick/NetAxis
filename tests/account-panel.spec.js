import {mount,flushPromises} from '@vue/test-utils'
import {describe,it,expect,vi} from 'vitest'
import AccountPanel from '../src/client/AccountPanel.vue'
describe('email and password form',()=>{
 it('requires matching confirmation and submits a signup once while waiting',async()=>{
  let finish;const request=vi.fn(()=>new Promise(resolve=>{finish=resolve}))
  const wrapper=mount(AccountPanel,{props:{request}})
  await wrapper.findAll('.account-tabs button')[1].trigger('click')
  await wrapper.find('input[type=email]').setValue('owner@example.test')
  const fields=wrapper.findAll('input[type=password]');await fields[0].setValue('Private-password-123!');await fields[1].setValue('Wrong-password-123!')
  await wrapper.find('form').trigger('submit');expect(request).not.toHaveBeenCalled();expect(wrapper.find('[role=alert]').text()).toContain('ไม่ตรงกัน')
  await fields[1].setValue('Private-password-123!');await wrapper.find('form').trigger('submit');await wrapper.find('form').trigger('submit')
  expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0]).toBe('/api/auth/register');expect(wrapper.find('.primary-action').attributes('disabled')).toBeDefined()
  finish({user:{id:'owner',email:'owner@example.test'}});await flushPromises();expect(wrapper.emitted('authenticated')[0][0].id).toBe('owner');wrapper.unmount()
 })
 it('shows login failure and allows retry without losing email',async()=>{
  const request=vi.fn().mockRejectedValue(Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง'));const wrapper=mount(AccountPanel,{props:{request}})
  await wrapper.find('input[type=email]').setValue('owner@example.test');await wrapper.find('input[type=password]').setValue('Private-password-123!');await wrapper.find('form').trigger('submit');await flushPromises()
  expect(wrapper.find('[role=alert]').text()).toContain('ไม่ถูกต้อง');expect(wrapper.find('input[type=email]').element.value).toBe('owner@example.test');expect(wrapper.find('.primary-action').attributes('disabled')).toBeUndefined();wrapper.unmount()
 })
})

it('identifies an invalid field on blur, clears its error on input and blocks an incomplete submission', async () => {
 const request = vi.fn()
 const wrapper = mount(AccountPanel, { props: { request } })
 const email = wrapper.find('input[type=email]')
 await email.setValue('invalid'); await email.trigger('blur')
 expect(email.attributes('aria-invalid')).toBe('true')
 expect(email.attributes('aria-describedby')).toBe('email-error')
 await email.setValue('owner@example.test')
 expect(email.attributes('aria-invalid')).toBe('false')
 await wrapper.find('form').trigger('submit')
 expect(request).not.toHaveBeenCalled()
 expect(wrapper.find('input[type=password]').attributes('aria-invalid')).toBe('true')
 wrapper.unmount()
})
