import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCiscoPdu } from '../src/shared/simulator.js'
import { ciscoForwardingPath } from '../src/shared/cisco-forwarding.js'
const n=(id,type,ip,vlan=1)=>({id,type,label:id,position:{x:0,y:0},data:{model:type==='router'?'router-4':type==='switch'?'switch-24':`${type}-default`,ipv4:ip,cidr:24,vlan:String(vlan),status:'online'}})
const e=(id,a,b,p,q)=>({id,sourceNodeId:a,targetNodeId:b,sourcePort:p,targetPort:q,status:'active',medium:'ethernet'})
const request={source:'a',target:'b',protocol:'ICMP'}
function routed(){const a=n('a','pc','10.1.0.10'),r=n('r','router','10.1.0.1'),b=n('b','server','10.2.0.20',2);a.data.gateway='10.1.0.1';b.data.gateway='10.2.0.1';r.data.ports=[{id:'G0/0',ipv4:'10.1.0.1',cidr:24,vlan:1},{id:'G0/1',ipv4:'10.2.0.1',cidr:24,vlan:2}];return {nodes:[a,r,b],edges:[e('ar','a','r','Eth0','G0/0'),e('rb','r','b','G0/1','Eth0')]}}
test('routed Ping requires both configured gateways; UDP checks only the forwarding direction',()=>{
 const t=routed();assert.equal(buildCiscoPdu(t,request).outcome,'success');delete t.nodes[0].data.gateway;assert.match(buildCiscoPdu(t,request).reason,/Missing default gateway/)
 t.nodes[0].data.gateway='10.1.0.1';delete t.nodes[2].data.gateway;const pdu=buildCiscoPdu(t,request);assert.match(pdu.reason,/Missing default gateway/);assert.ok(pdu.events.some(e=>e.action==='Received'&&e.toId==='b'));assert.equal(pdu.events.at(-1).toId,'b')
 t.nodes[2].data.services={http:false,tcpPorts:[],udpPorts:[53]};assert.equal(buildCiscoPdu(t,{...request,protocol:'UDP',destinationPort:53}).outcome,'success')
})
test('a wire across subnets cannot substitute for a routed interface, and services must be configured',()=>{
 const t=routed();t.nodes[1].data.ports[1].ipv4='';assert.match(buildCiscoPdu(t,request).reason,/No route/)
 t.nodes[1].data.ports[1].ipv4='10.2.0.1';assert.match(buildCiscoPdu(t,{...request,protocol:'TCP',destinationPort:443}).reason,/closed/)
 t.nodes[2].data.services={http:false,tcpPorts:[443],udpPorts:[]};assert.equal(buildCiscoPdu(t,{...request,protocol:'TCP',destinationPort:443}).outcome,'success')
})
test('ARP resolves gateway interface IP and router rewrites Ethernet headers while preserving end-to-end IPv4',()=>{
 const t=routed(),before=JSON.stringify(t),pdu=buildCiscoPdu(t,request)
 assert.equal(pdu.engine,'cisco-ipv4');assert.ok(pdu.events.some(e=>e.protocol==='ARP'&&e.frame.destinationIp==='10.1.0.1'));assert.ok(pdu.events.some(e=>e.protocol==='ARP'&&e.frame.sourceIp==='10.2.0.1'))
 const forwarded=pdu.events.find(e=>e.action==='IPv4 forwarded');assert.notEqual(forwarded.inbound.find(f=>f.name==='Source MAC').value,forwarded.outbound.find(f=>f.name==='Source MAC').value)
 assert.ok(pdu.events.filter(e=>e.protocol==='ICMP'&&e.frame.operation?.includes('Request')).every(e=>e.frame.sourceIp==='10.1.0.10'&&e.frame.destinationIp==='10.2.0.20'))
 assert.equal(JSON.stringify(t),before);assert.match(buildCiscoPdu(t,{...request,ttl:1}).reason,/TTL expired/)
 t.nodes[1].data.ports[1].status='down';assert.equal(buildCiscoPdu(t,request).outcome,'failed')
})
test('routing chooses longest prefix and the configured next hop, with independent return routes',()=>{
 const t=routed(),r=t.nodes[1],x=n('x','router','10.9.0.2',9);t.nodes.push(x);r.data.ports.push({id:'G0/2',ipv4:'10.9.0.1',cidr:24,vlan:9});t.edges.push(e('rx','r','x','G0/2','G0/0'));x.data.ports=[{id:'G0/0',ipv4:'10.9.0.2',cidr:24,vlan:9}]
 r.data.cisco={commands:[],ipRouting:true,routes:[{network:'10.2.0.20',prefix:32,nextHop:'10.9.0.2',port:'G0/2'}]}
 const path=ciscoForwardingPath(t,'a','b');assert.deepEqual(path.nodeIds,['a','r','x']);assert.match(path.error,/No route/);assert.equal(buildCiscoPdu(t,request).events.at(-1).toId,'x')
 x.data.cisco={commands:[],ipRouting:true,routes:[{network:'10.2.0.0',prefix:24,nextHop:'10.9.0.1',port:'G0/0'}]};assert.match(buildCiscoPdu(t,request).reason,/Routing loop/)
})
test('local ARP stays in its VLAN and configured invalid gateways cannot borrow another router',()=>{
 const t=routed();t.nodes[0].data.gateway='10.1.0.99';assert.match(buildCiscoPdu(t,request).reason,/ARP/)
 t.nodes[0].data.gateway='10.3.0.1';assert.match(buildCiscoPdu(t,request).reason,/outside/)
 assert.match(buildCiscoPdu(routed(),{...request,protocol:'ARP'}).reason,/Layer 2/)
})
test('warm ARP cache avoids repeated resolution but an explicit ARP scenario still broadcasts',()=>{
 const t={nodes:[n('a','pc','10.1.0.10'),n('b','server','10.1.0.20')],edges:[e('ab','a','b','Eth0','Eth0')]}
 const first=buildCiscoPdu(t,request),second=buildCiscoPdu(t,request,{cache:first.cache})
 assert.ok(first.events.some(e=>e.protocol==='ARP'));assert.ok(!second.events.some(e=>e.protocol==='ARP'))
 assert.ok(buildCiscoPdu(t,{...request,protocol:'ARP'},{cache:second.cache}).events.some(e=>e.action==='ARP request received'))
})
import { changeRoomSimulation } from '../src/server/lib/room-simulation.js'
test('private and shared Scenario runs use the same strict forwarding decision and event count',()=>{
 const t={...routed(),room:{revision:1}},options={...request,ttl:64,destinationPort:80,payloadBytes:32}
 delete t.nodes[0].data.gateway
 const direct=buildCiscoPdu(t,options),shared=changeRoomSimulation(t,null,{id:'owner',displayName:'Owner',role:'owner'},{revision:0,topologyRevision:1,action:'run',request:options})
 assert.equal(direct.outcome,'failed');assert.equal(shared.eventCount,direct.events.length);assert.equal(shared.eventCount,1)
})
