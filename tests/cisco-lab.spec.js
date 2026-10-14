import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import CiscoLab from '../src/client/CiscoLab.vue'
import { createCiscoLab } from '../src/client/lib/cisco-lab.js'
let wrapper, workers
const router = () => ({id:'r',type:'router',label:'R1',position:{x:0,y:0},data:{model:'router-4',status:'online'}})
beforeEach(() => {
  workers=[]
  class BrowserWorker {
    constructor() { workers.push(this) }
    postMessage(data) {
      let value
      try {
        if(data.action==='init') { this.lab=createCiscoLab(data.graph); value={ready:true,prompts:Object.fromEntries(data.graph.nodes.map(n=>[n.id,this.lab.prompt(n.id)]))} }
        else if(data.action==='saved') { this.lab.saved(data.nodeId); value={} }
        else if(data.action==='complete') value={completions:this.lab.complete(data.nodeId,data.input)}
        else value=this.lab.run(data.nodeId,data.input,data.writable)
      } catch(e) { value={error:e.message} }
      queueMicrotask(()=>this.onmessage?.({data:{id:data.id,...value}}))
    }
    terminate() { this.terminated=true }
  }
  vi.stubGlobal('Worker',BrowserWorker)
})
afterEach(()=>{ wrapper?.unmount(); document.body.innerHTML=''; vi.unstubAllGlobals() })
async function command(value) { await wrapper.get('[aria-label="คำสั่ง Cisco"]').setValue(value); await wrapper.get('form').trigger('submit'); await flushPromises() }
const button = text => wrapper.findAll('button').find(b=>b.text()===text)
it('uses a browser worker, edits config and saves through the existing project mutation', async () => {
  const save=vi.fn(async node=>{ await wrapper.setProps({topology:{nodes:[node],edges:[]}}); return true })
  wrapper=mount(CiscoLab,{props:{topology:{nodes:[router()],edges:[]},writable:true,save}}); await flushPromises()
  for(const line of ['enable','configure terminal','interface G0/0','ip address 10.0.0.1 255.255.255.0','no shutdown','end','show ip interface brief']) await command(line)
  expect(button('เปิดหน้าทดสอบ →').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('10.0.0.1'); expect(button('บันทึก Config ลงโปรเจกต์').attributes('disabled')).toBeUndefined()
  await button('บันทึก Config ลงโปรเจกต์').trigger('click'); await flushPromises()
  expect(button('เปิดหน้าทดสอบ →').attributes('disabled')).toBeUndefined()
  await button('เปิดหน้าทดสอบ →').trigger('click'); expect(wrapper.emitted('simulate')).toHaveLength(1)
  expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0].data.cisco.commands).toContain('ip address 10.0.0.1 255.255.255.0')
  await command('show ip route'); expect(button('บันทึก Config ลงโปรเจกต์').attributes('disabled')).toBeDefined()
  wrapper.unmount(); expect(workers[0].terminated).toBe(true); wrapper=null
})
it('blocks viewer writes and protects unsaved config when another member changes topology', async () => {
  const save=vi.fn()
  wrapper=mount(CiscoLab,{props:{topology:{nodes:[router()],edges:[]},writable:false,save}}); await flushPromises()
  for(const line of ['enable','configure terminal','interface G0/0','shutdown']) await command(line)
  expect(wrapper.text()).toContain('Viewer'); expect(button('บันทึก Config ลงโปรเจกต์').attributes('disabled')).toBeDefined(); expect(save).not.toHaveBeenCalled()
  await wrapper.setProps({writable:true}); await command('ip address 10.0.0.1 255.255.255.0')
  await wrapper.setProps({topology:{nodes:[{...router(),label:'Remote change'}],edges:[]}}); await flushPromises()
  expect(wrapper.text()).toContain('Topology เปลี่ยน'); expect(button('บันทึก Config ลงโปรเจกต์').attributes('disabled')).toBeDefined()
})
it('asks before discarding a draft and can reload without closing the lab', async () => {
  wrapper=mount(CiscoLab,{props:{topology:{nodes:[router()],edges:[]},writable:true,save:vi.fn()}}); await flushPromises(); for(const line of ['enable','configure terminal','hostname Changed']) await command(line)
  await button('โหลด Config ใหม่').trigger('click'); expect(wrapper.text()).toContain('Draft ที่ยังไม่บันทึก')
  await button('ทิ้ง Draft และโหลดใหม่').trigger('click'); await flushPromises(); expect(wrapper.emitted('close')).toBeUndefined(); expect(wrapper.text()).not.toContain('มี Config ที่ยังไม่บันทึก')
})

it('selects a PC directly and pings from its console without enable', async () => {
 const pc={id:'pc',type:'pc',label:'Users PC',position:{x:200,y:0},data:{model:'pc-default',status:'online',ipv4:'10.0.0.2',cidr:24,gateway:'10.0.0.1'}}
 const r=router();r.data.ipv4='10.0.0.1';r.data.cidr=24
 const topology={nodes:[r,pc],edges:[{id:'rp',sourceNodeId:'r',sourcePort:'G0/0',targetNodeId:'pc',targetPort:'Eth0',medium:'ethernet',status:'active'}]}
 wrapper=mount(CiscoLab,{props:{topology,writable:false,initialNodeId:'pc',save:vi.fn()}});await flushPromises()
 expect(wrapper.get('select').element.value).toBe('pc')
 expect(wrapper.text()).toContain('Users PC>')
 expect(button('ipconfig')).toBeDefined()
 expect(button('configure terminal')).toBeUndefined()
 await command('ping 10.0.0.1');expect(wrapper.text()).toContain('100 percent')
 await command('ipconfig');expect(wrapper.text()).toContain('Default gateway: 10.0.0.1')
 expect(button('บันทึก Config ลงโปรเจกต์').attributes('disabled')).toBeDefined()
 await wrapper.get('select').setValue('r');await flushPromises()
 expect(button('enable')).toBeDefined()
})
