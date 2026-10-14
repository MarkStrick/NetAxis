import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import DeviceLab from '../src/client/DeviceLab.vue'
const router={id:'r',type:'router',label:'Branch Router',data:{model:'router-4',ports:[{id:'G0/0',ipv4:'10.0.0.1',cidr:24,vlan:10}]}}
const topology={nodes:[router,{id:'pc',type:'pc',data:{}}],edges:[{id:'rp',sourceNodeId:'r',sourcePort:'G0/0',targetNodeId:'pc',targetPort:'Eth0'}]}
it('opens the connected interface directly and edits its IP without changing unrelated ports',async()=>{
 const wrapper=mount(DeviceLab,{props:{node:router,topology,participants:[],writable:true,section:'ports'}})
 expect(wrapper.get('.port-config').text()).toContain('G0/0')
 const address=wrapper.findAll('input').find(input=>input.element.value==='10.0.0.1')
 await address.setValue('10.0.0.2');await address.trigger('change')
 const data=wrapper.emitted('data')[0][0];expect(data.ports.find(p=>p.id==='G0/0').ipv4).toBe('10.0.0.2');expect(data.ports).toHaveLength(4)
 await wrapper.setProps({section:'security'});expect(wrapper.find('.port-config').exists()).toBe(false);expect(wrapper.text()).toContain('Firewall / ACL');wrapper.unmount()
})
it('shows a local error for an invalid ACL port before emitting any configuration',async()=>{
 const wrapper=mount(DeviceLab,{props:{node:router,topology,participants:[],writable:true,section:'security'}})
 await wrapper.get('input[type="number"]').setValue('65536')
 await wrapper.findAll('button').find(b=>b.text().includes('เพิ่ม ACL')).trigger('click')
 expect(wrapper.get('[role="alert"]').text()).toContain('1–65535');expect(wrapper.emitted('data')).toBeUndefined();wrapper.unmount()
})
