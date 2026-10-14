import { buildCiscoPdu } from '../../shared/simulator.js'

export const flowShapes = { process: 'ขั้นตอน', decision: 'เงื่อนไข', terminator: 'เริ่ม / จบ' }
export function parseFlowchart(input) {
  if (input?.format !== 'netaxis-flowchart' || input.version !== 1 || !Array.isArray(input.nodes) || !Array.isArray(input.edges) || input.nodes.length > 100 || input.edges.length > 200) throw Error('เลือกไฟล์ Flow Chart ของ NetAxis (ไม่เกิน 100 กล่องและ 200 ลูกศร)')
  const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 80
  const validText = text => typeof text === 'string' && text.length <= 120
  const nodes = input.nodes.map(n => {
    if (!validId(n.id) || !Object.hasOwn(flowShapes, n.shape) || !validText(n.label) || !Number.isFinite(n.x) || !Number.isFinite(n.y) || n.x < 0 || n.y < 0 || n.x > 10000 || n.y > 20000) throw Error('ข้อมูลกล่องหรือพิกัดไม่ถูกต้อง')
    return { id: n.id, shape: n.shape, label: n.label, x: n.x, y: n.y }
  })
  const ids = new Set(nodes.map(n => n.id))
  if (ids.size !== nodes.length) throw Error('รหัสกล่องซ้ำกัน')
  const edges = input.edges.map(e => {
    if (!validId(e.id) || !ids.has(e.source) || !ids.has(e.target) || e.source === e.target || !validText(e.label)) throw Error('ข้อมูลลูกศรไม่ถูกต้อง')
    return { id: e.id, source: e.source, target: e.target, label: e.label }
  })
  if (new Set(edges.map(e => e.id)).size !== edges.length) throw Error('รหัสลูกศรซ้ำกัน')
  return { format: 'netaxis-flowchart', version: 1, nodes, edges }
}
export const emptyFlowchart = () => ({ format: 'netaxis-flowchart', version: 1, nodes: [], edges: [] })
export function networkFlowchart(topology, source, target, protocol) {
  if (!source || !target || source === target || !topology.nodes.some(n => n.id === source) || !topology.nodes.some(n => n.id === target)) throw Error('เลือกต้นทางและปลายทางคนละเครื่องที่ยังอยู่บนผัง')
  const pdu = buildCiscoPdu(topology, { source, target, protocol })
  const events = pdu.events.filter(e => e.protocol !== 'ARP')
  const nodes = [{ id: 'start', shape: 'terminator', label: `เริ่ม ${protocol} · ${pdu.source}`, x: 40, y: 40 }]
  for (const event of events.slice(0, 97)) nodes.push({ id: `event-${nodes.length}`, shape: event.terminal === 'failed' ? 'decision' : 'process', label: `${event.from} → ${event.to} · ${event.action}`.slice(0, 120), x: 40, y: 40 + nodes.length * 120 })
  if (events.length > 97) nodes.push({ id: 'omitted', shape: 'process', label: `ย่อ ${events.length - 97} เหตุการณ์เพิ่มเติม`, x: 40, y: 40 + nodes.length * 120 })
  nodes.push({ id: 'end', shape: 'terminator', label: pdu.outcome === 'success' ? 'ส่งสำเร็จ' : `ส่งไม่สำเร็จ · ${pdu.reason}`.slice(0, 120), x: 40, y: 40 + nodes.length * 120 })
  return { chart: { format: 'netaxis-flowchart', version: 1, nodes, edges: nodes.slice(1).map((n, i) => ({ id: `link-${i}`, source: nodes[i].id, target: n.id, label: '' })) }, outcome: pdu.outcome, reason: pdu.reason }
}
