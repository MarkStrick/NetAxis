import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import DevicePicker from '../src/client/DevicePicker.vue'
import { deviceModels, portsFor, isBridge, supportsCiscoCli } from '../src/shared/devices.js'
import { networkRoute } from '../src/shared/network.js'
it('requires model selection and explicit Add, preserves failed choice and prevents double submission',async()=>{
 const add=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
 const wrapper=mount(DevicePicker,{props:{type:'router',category:'Router',load:async()=>({models:deviceModels}),add,writable:true}})
 await flushPromises();expect(add).not.toHaveBeenCalled();expect(wrapper.get('.primary-action').attributes('disabled')).toBeDefined()
 await wrapper.get('input[value="cisco-isr4331"]').setValue(true)
 expect(wrapper.get('.picker-spec').text()).toContain('3 GE');expect(add).not.toHaveBeenCalled()
 await wrapper.get('form').trigger('submit');await flushPromises();expect(wrapper.get('[role="alert"]').text()).toContain('ไม่สำเร็จ');expect(wrapper.emitted('close')).toBeUndefined()
 await wrapper.get('form').trigger('submit');await flushPromises();expect(add.mock.calls[1][0].id).toBe('cisco-isr4331');expect(wrapper.emitted('close')).toHaveLength(1);wrapper.unmount()
})
it('supports search, empty results and retry after catalog connection failure',async()=>{
 const load=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({models:deviceModels})
 const wrapper=mount(DevicePicker,{props:{type:'switch',category:'Switch',load,add:vi.fn(),writable:true}})
 await flushPromises();expect(wrapper.get('[role="alert"]').text()).toContain('โหลดรายการรุ่นไม่ได้')
 await wrapper.findAll('button').find(b=>b.text()==='ลองโหลดใหม่').trigger('click');await flushPromises()
 await wrapper.get('input[type="search"]').setValue('C9300L');expect(wrapper.findAll('input[type="radio"]')).toHaveLength(2)
 await wrapper.get('input[type="search"]').setValue('no-such-model');expect(wrapper.text()).toContain('ไม่พบรุ่น');wrapper.unmount()
})
it('keeps hardware interface counts and prevents a NAS from becoming a transit switch',()=>{
 const nas={id:'nas',type:'generic',data:{model:'synology-ds224plus'}},a={id:'a',type:'pc',data:{}},b={id:'b',type:'pc',data:{}}
 expect(portsFor(nas).map(p=>p.id)).toEqual(['LAN1','LAN2']);expect(isBridge(nas)).toBe(false)
 expect(networkRoute({nodes:[a,nas,b],edges:[{id:'an',sourceNodeId:'a',targetNodeId:'nas'},{id:'nb',sourceNodeId:'nas',targetNodeId:'b'}]},'a','b',{layer2:true})).toBeNull()
 expect(supportsCiscoCli({type:'router',data:{model:'mikrotik-hex-s'}})).toBe(false)
})
