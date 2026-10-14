import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import DialogFrame from '../src/client/DialogFrame.vue'

it('opens a named native modal, delegates Escape and restores focus to its trigger', () => {
  const trigger = document.createElement('button')
  trigger.textContent = 'Open'; document.body.append(trigger); trigger.focus()
  const wrapper = mount(DialogFrame, { attachTo: document.body, props: { title: 'Room settings', titleId: 'test-dialog-title' }, slots: { default: '<input aria-label="Room name" />' } })
  const dialog = wrapper.find('dialog')
  expect(dialog.attributes('open')).toBeDefined()
  expect(dialog.attributes('aria-labelledby')).toBe('test-dialog-title')
  const event = new Event('cancel', { cancelable: true })
  dialog.element.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(wrapper.emitted('close')).toHaveLength(1)
  wrapper.unmount()
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})
