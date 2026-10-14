import { createDevice, createTopology, createParserState, parseCommand, transitionMode, getPrompt, getCompletions, executeCommand, EventQueue, addConnectedRoutes } from '../vendor/cisco-real-sim/engine.js'
import { portsFor, resolvedPorts } from '../../shared/devices.js'
import { calculateSubnet, intToIpv4, ipv4ToInt } from '../../server/lib/subnet.js'
import { ciscoRoute } from '../../shared/network.js'
import { buildCiscoPdu as buildPdu, simulationMac } from '../../shared/simulator.js'

const modes = new Set(['ENABLE','DISABLE','CONFIGURE_TERMINAL','EXIT','END','EXIT_INTERFACE'])
const hostnameFor = (name,id,type) => { const value=name.replace(/[^a-z0-9_-]/gi,'-').slice(0,63); return /^[a-z]/i.test(value) ? value : `${type === 'switch' ? 'S' : 'R'}${Number(id.slice(1))+1}` }
const supported = new Set([...modes,'INTERFACE','HOSTNAME','IP_ADDRESS','NO_IP_ADDRESS','SHUTDOWN','NO_SHUTDOWN','DESCRIPTION','NO_DESCRIPTION','IP_ROUTE','NO_IP_ROUTE','IP_ROUTING','NO_IP_ROUTING','VLAN_CREATE','VLAN_DELETE','SWITCHPORT_MODE','SWITCHPORT_ACCESS_VLAN','SWITCHPORT_TRUNK_ALLOWED','WRITE_MEMORY','COPY_RUN_START','PING','HELP_CONTEXT'])
const prefix = mask => {
  const n = ipv4ToInt(mask), bits = n?.toString(2).padStart(32, '0')
  return bits && /^1*0*$/.test(bits) ? bits.indexOf('0') === -1 ? 32 : bits.indexOf('0') : null
}
const maskFor = cidr => intToIpv4(cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0)

export function createCiscoLab(graph) {
  const topology = createTopology(), devices = new Map(), states = new Map(), logs = new Map(), drafts = new Map(), renamed = new Map()
  const original = structuredClone(graph), initialInterfaces = new Map()
  for (const [index, node] of original.nodes.entries()) {
    const type = ['switch','access-point','generic'].includes(node.type) ? 'switch' : 'router'
    const id = `d${index}`, d = createDevice(type, hostnameFor(node.label,id,type), node.position)
    d.id = id; d.isRunning = node.data.status !== 'offline'; d.ipRouting = node.type !== 'switch' || node.data.model === 'switch-l3'
    d.interfaces = portsFor(node).map((p,i) => ({ ...structuredClone(d.interfaces[0]), id: `${id}-p${i}`, name: p.id.replace(/^Te/, 'TenGigabitEthernet').replace(/^G/, 'GigabitEthernet').replace(/^Eth/, 'Ethernet'),
      ip: p.ipv4 !== undefined ? p.ipv4 || null : i === 0 ? node.data.ipv4 || null : null, subnetMask: p.ipv4 ? maskFor(p.cidr ?? 24) : p.ipv4 === undefined && i === 0 && node.data.ipv4 ? maskFor(node.data.cidr ?? 24) : null,
      mac: simulationMac(node), isShutdown: p.status === 'down', status: p.status === 'down' ? 'administratively down' : 'down', connectedTo: null,
      switchportMode: p.mode, accessVlan: p.vlan, trunkVlans: [...p.allowedVlans], canvasPort: p.id,
    }))
    d.routingTable = (node.data.cisco?.routes || []).filter(r => r.nextHop).map(r => ({network:r.network,mask:maskFor(r.prefix),nextHop:r.nextHop,interface:d.interfaces.find(p => p.canvasPort === r.port)?.name,protocol:'S',metric:1,isIPv6:false})); addConnectedRoutes(d)
    topology.devices.set(id,d); devices.set(node.id,d); states.set(node.id,createParserState()); logs.set(node.id,[])
  }
  for (const edge of resolvedPorts(original)) {
    if (edge.status === 'inactive') continue
    const a = devices.get(edge.sourceNodeId), b = devices.get(edge.targetNodeId)
    const ap = a?.interfaces.find(p => p.canvasPort === edge.sourcePort), bp = b?.interfaces.find(p => p.canvasPort === edge.targetPort)
    if (!ap || !bp || !a.isRunning || !b.isRunning) continue
    ap.connectedTo = `${b.id}/${bp.id}`; bp.connectedTo = `${a.id}/${ap.id}`
    if (!ap.isShutdown) ap.status = 'up'; if (!bp.isShutdown) bp.status = 'up'
    topology.links.set(edge.id,{id:edge.id,from:`${a.id}/${ap.id}`,to:`${b.id}/${bp.id}`,status:'up'})
  }
  for (const [id,d] of devices) initialInterfaces.set(id,structuredClone(d.interfaces))
  function changes(nodeId) {
    const node = original.nodes.find(n => n.id === nodeId), d = devices.get(nodeId)
    if (node.type === 'pc') return structuredClone(node)
    const ports = d.interfaces.filter(p => p.canvasPort).map(p => ({ id:p.canvasPort, status:p.isShutdown ? 'down':'up', mode:p.switchportMode === 'trunk' ? 'trunk':'access', vlan:p.accessVlan || 1,
      allowedVlans:p.trunkVlans.length ? p.trunkVlans : Array.from({length:4094},(_,i)=>i+1), ipv4:p.ip || '',cidr:p.ip ? prefix(p.subnetMask) : 24,
    }))
    const routes = d.routingTable.filter(r => !r.isIPv6).map(r => {
      const direct = d.interfaces.find(p => p.name === r.interface), next = r.nextHop && d.interfaces.find(p => p.ip && calculateSubnet(p.ip,prefix(p.subnetMask))?.networkAddress === calculateSubnet(r.nextHop,prefix(p.subnetMask))?.networkAddress)
      return {network:r.network,prefix:prefix(r.mask),nextHop:r.nextHop || '',port:(direct || next)?.canvasPort || ''}
    }).filter(r => r.prefix !== null && r.port)
    const first = ports.find(p => p.ipv4)
    return { ...node, label:renamed.get(nodeId) ? d.name : node.label, data:{...node.data,ipv4:first?.ipv4 || '',...(first ? {cidr:first.cidr}:{}),ports,
      cisco:{commands:[...logs.get(nodeId)],routes,ipRouting:d.ipRouting},
    } }
  }
  function currentGraph() {
    return {...original,nodes:original.nodes.map(n => logs.get(n.id).length ? changes(n.id) : structuredClone(n))}
  }
  function run(nodeId, input, writable = true, replay = false) {
    const d = devices.get(nodeId), state = states.get(nodeId), node = original.nodes.find(n => n.id === nodeId)
    if (!d || !state) throw new Error('Device not found')
    if (typeof input !== 'string' || input.length > 512) throw new Error('คำสั่งยาวเกิน 512 ตัวอักษร')
    const pc = node.type === 'pc', tokens = input.trim().split(/\s+/)
    const parsed = pc ? {success:true,action:tokens[0].toLowerCase() === 'ping' && tokens.length === 2 ? {type:'PING',params:{target:tokens[1]}} : null} : parseCommand(input,state,d.name), action = parsed.action
    const result = output => ({output,prompt:pc ? `${node.label}>` : getPrompt(state,d.name),node:changes(nodeId),dirty:drafts.get(nodeId) || false})
    if (pc && !action) {
      if (!input.trim()) return result('')
      if (input.trim().toLowerCase() === 'ipconfig') return result(`IPv4: ${node.data.ipv4 || 'ยังไม่ได้ตั้งค่า'}\nPrefix: /${node.data.cidr ?? 24}\nDefault gateway: ${node.data.gateway || 'ยังไม่ได้ตั้งค่า'}`)
      return result('คำสั่ง PC: ping <IPv4>, ipconfig — ตั้งค่า IP/Gateway ผ่าน Properties')
    }
    if (!parsed.success) return result(parsed.error || '% Invalid command')
    if (!action) return result('')
    // shortcut: only commands verified with NetAxis's data model are enabled; extend with protocol tests.
    if (!supported.has(action.type) && !action.type.startsWith('SHOW_')) return result('% คำสั่งนี้ยังไม่รองรับใน NetAxis Cisco Lab')
    const changesConfig = !modes.has(action.type) && action.type !== 'INTERFACE' && !action.type.startsWith('SHOW_') && !['PING','HELP_CONTEXT'].includes(action.type)
    if (!writable && changesConfig) return result('% Viewer อ่านค่าและทดสอบได้ แต่แก้ Config ไม่ได้')
    if ((changesConfig || modes.has(action.type) || action.type === 'INTERFACE') && logs.get(nodeId).length >= 250) return result('% ถึงขีดจำกัด 250 คำสั่งต่ออุปกรณ์ กรุณาบันทึกและปรับ Config ผ่าน Properties')
    if (action.type === 'INTERFACE') {
      const value = action.params.interface.toLowerCase(), iface = d.interfaces.find(p => [p.name,p.canvasPort].some(name => name?.toLowerCase() === value))
      if (!iface) return result('% เลือกพอร์ตที่มีอยู่บน Canvas เท่านั้น เช่น interface G0/0')
      action.params.interface = iface.name
    }
    if (action.type === 'SHOW_STARTUP_CONFIG') return result(d.startupConfig.length ? d.startupConfig.join('\n') : '% startup-config ยังไม่ได้บันทึกด้วย write memory')
    if (action.type === 'PING') {
      if (replay) return result('')
      const g = currentGraph(); g.nodes = g.nodes.map(n => n.id === nodeId ? changes(n.id) : n); const target = g.nodes.find(n => n.data.ipv4 === action.params.target || n.data.ports?.some(p => p.ipv4 === action.params.target))
      const route = ciscoRoute(changes(nodeId),action.params.target)
      const outgoing = d.interfaces.find(p => p.canvasPort === route?.port && p.ip && !p.isShutdown)
      const source = g.nodes.find(n => n.id === nodeId)
      if (outgoing) source.data = {...source.data,ipv4:outgoing.ip,cidr:prefix(outgoing.subnetMask)}
      if (target && target.data.ipv4 !== action.params.target) { const p = target.data.ports.find(p => p.ipv4 === action.params.target); target.data = {...target.data,ipv4:p.ipv4,cidr:p.cidr} }
      if (d.interfaces.some(p => p.ip === action.params.target && !p.isShutdown)) return result('Success rate is 100 percent (5/5) — local interface')
      if (!target) return result('Success rate is 0 percent (0/5) — ไม่พบปลายทางบน Canvas')
      const pdu = buildPdu(g,{source:nodeId,target:target.id,protocol:'ICMP'})
      return {...result(pdu.outcome === 'success' ? '!!!!!\nSuccess rate is 100 percent (5/5)' : `.....\nSuccess rate is 0 percent (0/5)\n${pdu.reason}`),pdu}
    }
    const execution = action.type === 'IP_ROUTING' && d.type !== 'switch' ? (d.ipRouting=true,{success:true,output:'',stateChanged:true}) : modes.has(action.type) ? {success:true,output:'',stateChanged:false} : executeCommand(action,topology,d,state.configTarget,new EventQueue(),state)
    if (!execution.success) return result(execution.error || execution.output || '% Command failed')
    if (action.type === 'HOSTNAME') renamed.set(nodeId,true)
    transitionMode(state,action)
    for (const iface of d.interfaces) iface.status = iface.isShutdown ? 'administratively down' : iface.connectedTo ? 'up' : 'down'
    addConnectedRoutes(d)
    if (writable && (modes.has(action.type) || action.type === 'INTERFACE' || execution.stateChanged)) {
      logs.get(nodeId).push(input)
      if (!replay && execution.stateChanged) drafts.set(nodeId,true)
    }
    return result(execution.output || '')
  }
  for (const n of original.nodes) {
    for (const command of n.data.cisco?.commands || []) run(n.id,command,true,true)
    if (n.data.cisco) {
      // Saved Canvas fields remain authoritative when someone edits Properties after CLI use.
      const d=devices.get(n.id); d.interfaces=initialInterfaces.get(n.id); d.name=hostnameFor(n.label,d.id,d.type); d.ipRouting=n.data.cisco.ipRouting; d.routingTable=(n.data.cisco.routes || []).filter(r => r.nextHop).map(r => ({network:r.network,mask:maskFor(r.prefix),nextHop:r.nextHop,interface:d.interfaces.find(p => p.canvasPort === r.port)?.name,protocol:'S',metric:1,isIPv6:false})); addConnectedRoutes(d)
    }
  }
  const isPc = id => original.nodes.find(n => n.id === id)?.type === 'pc'
  return {run,changes,saved:id=>drafts.set(id,false),prompt:id=>isPc(id) ? `${original.nodes.find(n=>n.id===id).label}>` : getPrompt(states.get(id),devices.get(id).name),complete:(id,input)=>isPc(id) ? ['ping ', 'ipconfig'].filter(c=>c.startsWith(input.toLowerCase())) : getCompletions(input,states.get(id).mode),graph:currentGraph}
}
