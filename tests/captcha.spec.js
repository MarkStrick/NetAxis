import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import CaptchaDialog from '../src/client/CaptchaDialog.vue'
let wrapper
afterEach(() => { wrapper?.unmount(); vi.useRealTimers() })
it('refreshes invalid one-use challenges and preserves the failure explanation', async () => {
  let id = 0
  const request = vi.fn(async () => ({ id: `challenge-${++id}`, image: 'data:image/png;base64,', expiresAt: Date.now() + 300000 }))
  const verify = vi.fn().mockRejectedValueOnce(new Error('รหัสไม่ถูกต้อง')).mockResolvedValueOnce(undefined)
  wrapper = mount(CaptchaDialog, { props: { request, verify } }); await flushPromises()
  await wrapper.find('input').setValue('123456'); await wrapper.find('form').trigger('submit'); await flushPromises()
  expect(verify).toHaveBeenLastCalledWith({ id: 'challenge-1', answer: '123456' }); expect(request).toHaveBeenCalledTimes(2)
  expect(wrapper.find('input').element.value).toBe(''); expect(wrapper.text()).toContain('รหัสไม่ถูกต้อง')
  await wrapper.find('input').setValue('654321'); await wrapper.find('form').trigger('submit'); await flushPromises()
  expect(verify).toHaveBeenLastCalledWith({ id: 'challenge-2', answer: '654321' }); expect(wrapper.emitted('verified')).toHaveLength(1)
})
it('disables expired challenges and blocks duplicate submits while a request is pending', async () => {
  vi.useFakeTimers(); let complete
  const verify = vi.fn(() => new Promise(resolve => { complete = resolve }))
  wrapper = mount(CaptchaDialog, { props: { request: async () => ({ id: 'challenge', image: 'data:image/png;base64,', expiresAt: Date.now() + 1000 }), verify } }); await flushPromises()
  await wrapper.find('input').setValue('123456'); await wrapper.find('form').trigger('submit'); await wrapper.find('form').trigger('submit'); expect(verify).toHaveBeenCalledTimes(1)
  complete(); await flushPromises(); await vi.advanceTimersByTimeAsync(1000)
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined(); expect(wrapper.text()).toContain('ภาพหมดอายุแล้ว')
})
