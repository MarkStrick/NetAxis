import test from 'node:test'
import assert from 'node:assert/strict'
import { createCiscoLab } from '../src/client/lib/cisco-lab.js'
import { buildPdu } from '../src/shared/simulator.js'
import { nodeSchema, parseOrThrow } from '../src/server/lib/validation.js'
import { parseWorkspace } from '../src/server/lib/workspace-schema.js'
const n = (id,type,ip) => ({id,type,label:id,position:{x:0,y:0},data:{model:type==='router'?'router-4':type==='switch'?'switch-24':'pc-default',status:'online',...(ip?{ipv4:ip,cidr:24}:{})}})
const e = (id,a,b,p,q='Eth0') => ({id,sourceNodeId:a,targetNodeId:b,sourcePort:p,targetPort:q,medium:'ethernet',status:'active'})
const run = (lab,id,commands) => { for (const c of commands) { const result=lab.run(id,c); assert.ok(!result.output.startsWith('%'),c+': '+result.output) } }
const configure = (lab,id,port,ip) => run(lab,id,['enable','configure terminal',`interface ${port}`,`ip address ${ip} 255.255.255.0`,'no shutdown','end'])

test('Cisco CLI configures interfaces, validates input and produces real topology-based Ping outcomes', () => {
  const g={nodes:[n('R1','router'),n('PC','pc','10.0.0.2')],edges:[e('rp','R1','PC','G0/0')]}, lab=createCiscoLab(g)
  configure(lab,'R1','G0/0','10.0.0.1')
  assert.match(lab.run('R1','show ip interface brief').output,/10\.0\.0\.1/)
  assert.match(lab.run('R1','ping 10.0.0.2').output,/100 percent/)
  const saved=parseOrThrow(nodeSchema,lab.changes('R1')); assert.equal(saved.data.ports[0].ipv4,'10.0.0.1')
  const restored=createCiscoLab({...g,nodes:[saved,g.nodes[1]]}); assert.match(restored.run('R1','ping 10.0.0.2').output,/100 percent/)
  run(lab,'R1',['configure terminal','interface G0/0','shutdown','end'])
  assert.match(lab.run('R1','ping 10.0.0.2').output,/0 percent \(0\/5\)/)
  run(lab,'R1',['configure terminal','interface G0/0']); assert.match(lab.run('R1','ip address 999.1.1.1 255.255.255.0').output,/Invalid/)
  assert.equal(lab.changes('R1').data.ports[0].ipv4,'10.0.0.1')
  run(lab,'R1',['end','configure terminal']); assert.match(lab.run('R1','router ospf 1').output,/ยังไม่รองรับ/)
  assert.match(lab.run('R1','interface G0/99').output,/เลือกพอร์ต|Invalid/)
})
test('static routes control both Cisco Ping and the shared Simulator; unreachable next hops fail', () => {
  const pc=n('PC','pc','10.2.0.10'); pc.data.gateway='10.2.0.1'
  const g={nodes:[n('R1','router'),n('R2','router'),pc],edges:[e('rr','R1','R2','G0/0','G0/0'),e('rp','R2','PC','G0/1')]},lab=createCiscoLab(g)
  configure(lab,'R1','G0/0','10.0.12.1'); configure(lab,'R2','G0/0','10.0.12.2'); configure(lab,'R2','G0/1','10.2.0.1')
  assert.match(lab.run('R1','ping 10.2.0.10').output,/0 percent \(0\/5\)/)
  run(lab,'R1',['configure terminal','ip route 10.2.0.0 255.255.255.0 10.0.12.2','end'])
  assert.match(lab.run('R1','ping 10.2.0.10').output,/100 percent/)
  assert.equal(buildPdu(lab.graph(),{source:'R1',target:'PC',protocol:'ICMP'}).outcome,'success')
  run(lab,'R1',['configure terminal','no ip route 10.2.0.0 255.255.255.0 10.0.12.2','ip route 10.2.0.0 255.255.255.0 10.0.12.99','end'])
  assert.match(lab.run('R1','ping 10.2.0.10').output,/0 percent \(0\/5\)/)
})
test('VLAN and existing ACL checks are preserved, viewers cannot mutate config', () => {
  const g={nodes:[n('R','router','10.0.0.1'),n('S','switch'),n('PC','pc','10.0.0.2')],edges:[e('rs','R','S','G0/0','G0/0'),e('sp','S','PC','G0/1')]},lab=createCiscoLab(g)
  run(lab,'R',['enable']); assert.match(lab.run('R','ping 10.0.0.2').output,/100 percent/)
  run(lab,'S',['enable','configure terminal','vlan 10','interface G0/1','switchport mode access','switchport access vlan 10','end'])
  assert.match(lab.run('R','ping 10.0.0.2').output,/0 percent \(0\/5\)/)
  const viewer=createCiscoLab(g); viewer.run('R','enable',false); viewer.run('R','configure terminal',false); viewer.run('R','interface G0/0',false)
  assert.match(viewer.run('R','shutdown',false).output,/Viewer/); assert.equal(viewer.changes('R').data.ports[0].status,'up'); assert.equal(viewer.changes('R').data.cisco.commands.length,0)
  g.nodes[1].data.acl=[{action:'deny',protocol:'ICMP',source:'any',destination:'any'}]
  const blocked=createCiscoLab(g); blocked.run('R','enable'); assert.match(blocked.run('R','ping 10.0.0.2').output,/ACL blocked/)
})
test('Workspace JSON preserves Cisco config and rejects oversized or malformed config', () => {
  const lab=createCiscoLab({nodes:[n('R','router')],edges:[]}); configure(lab,'R','G0/0','10.0.0.1'); run(lab,'R',['write memory'])
  const node=lab.changes('R'); const workspace=parseWorkspace({format:'netaxis-workspace',version:1,room:{name:'CLI'},nodes:[node],edges:[],plan:null,template:null})
  assert.deepEqual(workspace.nodes[0].data.cisco.commands,node.data.cisco.commands)
  assert.throws(()=>parseOrThrow(nodeSchema,{...node,data:{...node.data,cisco:{...node.data.cisco,commands:Array(251).fill('enable')}}}))
  assert.throws(()=>parseOrThrow(nodeSchema,{...node,data:{...node.data,cisco:{...node.data.cisco,routes:[{network:'bad',prefix:24,nextHop:'',port:'G0/0'}]}}}))
  assert.throws(()=>parseOrThrow(nodeSchema,{...node,data:{...node.data,cisco:{...node.data.cisco,routes:[{network:'10.0.0.0',prefix:24,nextHop:'',port:'G0/99'}]}}}))
})

test('Properties edits take precedence over saved CLI replay; startup config remains the saved CLI commands', () => {
  const node=n('R','router'),lab=createCiscoLab({nodes:[node],edges:[]}); configure(lab,'R','G0/0','10.0.0.1'); lab.run('R','write memory')
  const saved=lab.changes('R'); saved.data.ports[0].ipv4='10.9.0.1'; saved.data.ipv4='10.9.0.1'
  const loaded=createCiscoLab({nodes:[saved],edges:[]}); assert.match(loaded.run('R','show ip interface brief').output,/10\.9\.0\.1/)
  assert.match(loaded.run('R','show startup-config').output,/10\.0\.0\.1/)
  loaded.saved('R'); assert.equal(loaded.run('R','show ip route').dirty,false)
})

test('show/enable alone do not create a config draft or rename human-readable canvas labels', () => {
  const node={...n('R','router'),label:'เราเตอร์สำนักงาน'},lab=createCiscoLab({nodes:[node],edges:[]})
  assert.equal(lab.run('R','enable').dirty,false); assert.equal(lab.run('R','show ip route').dirty,false); assert.equal(lab.changes('R').label,node.label)
})

test('the shared Simulator chooses a CLI router source IP from its outgoing interface without mutating the project', () => {
  const g={nodes:[n('R','router'),n('PC','pc','10.2.0.10')],edges:[e('rp','R','PC','G0/1')]},lab=createCiscoLab(g)
  configure(lab,'R','G0/0','10.1.0.1'); configure(lab,'R','G0/1','10.2.0.1')
  const saved=lab.graph(),before=JSON.stringify(saved),pdu=buildPdu(saved,{source:'R',target:'PC',protocol:'ICMP'})
  assert.equal(pdu.outcome,'success'); assert.equal(pdu.events[0].frame.sourceIp,'10.2.0.1'); assert.equal(JSON.stringify(saved),before)
})

test('real Cisco router interfaces retain saved IP and Cisco switch uplinks accept their full names', () => {
  const router={...n('R','router'),data:{model:'cisco-isr4331'}}
  const lab=createCiscoLab({nodes:[router],edges:[]})
  configure(lab,'R','G0/0/2','10.0.0.1')
  const saved=lab.changes('R');assert.equal(saved.data.ports.length,3)
  assert.equal(saved.data.ports.find(p=>p.id==='G0/0/2').ipv4,'10.0.0.1')
  assert.equal(parseOrThrow(nodeSchema,saved).data.model,'cisco-isr4331')
  const sw={...n('S','switch'),data:{model:'cisco-c9300l-48p-4x'}}
  const switchLab=createCiscoLab({nodes:[sw],edges:[]})
  run(switchLab,'S',['enable','configure terminal','interface TenGigabitEthernet1/1/4','no shutdown','end'])
  assert.equal(switchLab.changes('S').data.ports.length,52)
})

test('unmanaged hardware cannot be configured as a VLAN trunk', () => {
 const sw={...n('S','switch'),data:{model:'tplink-sg108',ports:[{id:'Port1',mode:'trunk',vlan:1,allowedVlans:[1,10]}]}}
 assert.throws(()=>parseOrThrow(nodeSchema,sw),/Unmanaged/)
 sw.data.ports[0].mode='access';sw.data.ports[0].allowedVlans=[1]
 assert.equal(parseOrThrow(nodeSchema,sw).data.model,'tplink-sg108')
})
