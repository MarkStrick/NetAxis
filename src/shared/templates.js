// Reference designs with valid addressing, saved IPAM and runnable scenarios.
// These addresses are examples. Hardware configuration and live probes are separate.
const node = (id, type, label, ip, vlan, x, y, gateway, notes = '') => ({ id, type, label, position: { x, y }, data: { ipv4: ip, cidr: 24, vlan: String(vlan), status: 'online', notes: `${notes}${gateway ? ` | Gateway ${gateway}` : ''}` } })
const link = (id, from, to, label = 'Access', extra = {}) => ({ id, sourceNodeId: from, targetNodeId: to, medium: 'ethernet', bandwidth: '1 Gbps', status: 'active', label, ...extra })
const segment = (id, name, site, vlan, network, hosts, growth = 20) => ({ id, name, site, department: name, vlan, hosts, growth, reservedCount: 4, cidr: `${network}.0/24`, gateway: `${network}.1`, reservedIps: [240, 241, 242, 243].map(v => `${network}.${v}`) })
const scenario = (id, name, source, target, protocol = 'ICMP', extra = {}) => ({ id, name, source, target, protocol, ttl: 64, destinationPort: protocol === 'UDP' ? 53 : 443, payloadBytes: 32, expected: 'success', ...extra })
function finalize(preset) {
  preset.meta = `${preset.nodes.length} devices · ${preset.plan.segments.length} subnets · ${preset.scenarios.length} scenarios`
  preset.plan.assignments = preset.nodes.filter(n => n.data.ipv4).flatMap(n => {
    const s = preset.plan.segments.find(s => n.data.ipv4.startsWith(s.cidr.split('.').slice(0, 3).join('.') + '.') && s.cidr.endsWith('/24'))
    return s && n.data.ipv4 !== s.gateway ? [{ segmentId: s.id, ip: n.data.ipv4, kind: n.type === 'server' ? 'server' : 'device', label: n.label, mac: '' }] : []
  }).concat(preset.plan.assignments || [])
  return preset
}
export const presetProjects = [
  finalize({
    id: 'office-lan', name: 'Small Office · Ready LAN', tone: 'cyan',
    description: 'สำนักงาน 50 users พร้อม Wi-Fi, printer และ server เริ่มตรวจ PC ↔ Server ได้ทันที',
    useCase: 'ทดสอบการเชื่อมต่อภายในสำนักงาน และเตรียม IP inventory ก่อนติดตั้ง',
    plan: { parent: '10.50.0.0/24', segments: [segment('office', 'Office LAN', 'Office', 10, '10.50.0', 50)], assignments: [] },
    nodes: [
      node('office-pc1', 'pc', 'Staff PC 01', '10.50.0.10', 10, 700, 110, '10.50.0.1'),
      node('office-pc2', 'pc', 'Staff PC 02', '10.50.0.11', 10, 700, 230, '10.50.0.1'),
      node('office-server', 'server', 'File / App Server', '10.50.0.20', 10, 700, 350, '10.50.0.1', 'TCP service is assumed by the simulator'),
      node('office-printer', 'printer', 'Office Printer', '10.50.0.30', 10, 700, 470, '10.50.0.1'),
      node('office-switch', 'switch', 'Office Switch', '10.50.0.2', 10, 430, 290, '10.50.0.1'),
      node('office-router', 'router', 'LAN Gateway', '10.50.0.1', 10, 130, 290, ''),
      node('office-ap', 'access-point', 'Staff Wi-Fi AP', '10.50.0.3', 10, 430, 540, '10.50.0.1'),
      node('office-wifi', 'pc', 'Wi-Fi Laptop', '10.50.0.12', 10, 700, 600, '10.50.0.1'),
    ],
    edges: [link('office-uplink', 'office-router', 'office-switch', 'LAN uplink'), ...['pc1', 'pc2', 'server', 'printer'].map(v => link(`office-${v}-link`, 'office-switch', `office-${v}`, 'VLAN 10')), link('office-ap-link', 'office-switch', 'office-ap', 'VLAN 10'), link('office-wifi-link', 'office-ap', 'office-wifi', 'Staff Wi-Fi', { medium: 'wifi', bandwidth: '866 Mbps' })],
    scenarios: [scenario('office-ping', 'PC → Server · ICMP round trip', 'office-pc1', 'office-server'), scenario('office-app', 'PC → App service · TCP 443', 'office-pc2', 'office-server', 'TCP'), scenario('office-print', 'PC → Printer · TCP 9100', 'office-pc1', 'office-printer', 'TCP', { destinationPort: 9100 }), scenario('office-wireless', 'Wi-Fi → Server · ICMP', 'office-wifi', 'office-server')],
    checklist: ['นำ IP/CIDR/gateway ไปกำหนดบนอุปกรณ์จริง และเปลี่ยน IP ตัวอย่างให้ตรงกับ site', 'ตั้ง access ports และ SSID เป็น VLAN 10', 'ติดตั้ง Probe ใน Office LAN; ตรวจ IPAM และเติม expected MAC จากอุปกรณ์จริง', 'ทดสอบ ping/neighbor แล้วเทียบ Unexpected/Missing/Reserved conflict'],
  }),
  finalize({
    id: 'office-vlans', name: 'Office · Users / Servers / Guest', tone: 'violet',
    description: 'แยก Users, Servers และ Guest เป็น 3 subnet พร้อม L3 path และ IPAM สำหรับวางแผนสำนักงาน',
    useCase: 'ตรวจการแบ่ง VLAN และประเมิน capacity ก่อนเพิ่มผู้ใช้หรือ server',
    plan: { parent: '10.51.0.0/16', segments: [segment('users', 'Users', 'HQ', 10, '10.51.10', 100, 30), segment('servers', 'Servers', 'HQ', 20, '10.51.20', 30, 50), segment('guest', 'Guest', 'HQ', 30, '10.51.30', 80, 30)], assignments: [] },
    nodes: [node('vlan-pc', 'pc', 'Staff PC', '10.51.10.10', 10, 850, 90, '10.51.10.1'), node('vlan-staff2', 'pc', 'Staff Laptop', '10.51.10.11', 10, 850, 200, '10.51.10.1'), node('vlan-router', 'router', 'VLAN Gateway', '10.51.10.1', 10, 150, 300, '', 'Actual hardware needs gateway interfaces .1 on VLANs 10,20,30; ACL is not modeled'), node('vlan-users-sw', 'switch', 'Users Switch', '10.51.10.2', 10, 480, 150, '10.51.10.1'), node('vlan-servers-sw', 'switch', 'Server Switch', '10.51.20.2', 20, 480, 330, '10.51.20.1'), node('vlan-app', 'server', 'Application Server', '10.51.20.10', 20, 850, 310, '10.51.20.1'), node('vlan-dns', 'server', 'DNS Reference Host', '10.51.20.53', 20, 850, 420, '10.51.20.1', 'UDP 53 is modeled as a datagram; DNS records are not resolved'), node('vlan-guest-sw', 'switch', 'Guest AP / Bridge', '10.51.30.2', 30, 480, 570, '10.51.30.1'), node('vlan-guest1', 'pc', 'Guest Laptop 01', '10.51.30.10', 30, 850, 550, '10.51.30.1'), node('vlan-guest2', 'pc', 'Guest Laptop 02', '10.51.30.11', 30, 850, 640, '10.51.30.1')],
    edges: [link('vlan-users-up', 'vlan-router', 'vlan-users-sw', 'VLAN 10'), link('vlan-servers-up', 'vlan-router', 'vlan-servers-sw', 'VLAN 20'), link('vlan-guest-up', 'vlan-router', 'vlan-guest-sw', 'VLAN 30'), link('vlan-pc-access', 'vlan-users-sw', 'vlan-pc'), link('vlan-staff2-access', 'vlan-users-sw', 'vlan-staff2'), link('vlan-app-access', 'vlan-servers-sw', 'vlan-app'), link('vlan-dns-access', 'vlan-servers-sw', 'vlan-dns'), link('vlan-guest1-access', 'vlan-guest-sw', 'vlan-guest1'), link('vlan-guest2-access', 'vlan-guest-sw', 'vlan-guest2')],
    scenarios: [scenario('vlans-app', 'Users → Servers · routed TCP 443', 'vlan-pc', 'vlan-app', 'TCP'), scenario('vlans-dns', 'Users → DNS host · UDP 53', 'vlan-pc', 'vlan-dns', 'UDP'), scenario('vlans-guest', 'Guest ↔ Guest · ICMP', 'vlan-guest1', 'vlan-guest2'), scenario('vlans-local', 'Users ↔ Users · ARP', 'vlan-pc', 'vlan-staff2', 'ARP')],
    checklist: ['กำหนด gateway interfaces และ routes บนอุปกรณ์จริงสำหรับทุก VLAN', 'กำหนด Guest isolation/firewall policy บน hardware; Simulator ไม่ประเมิน ACL', 'เพิ่ม Probe อย่างน้อย VLAN 10,20,30 เพื่อเก็บ observation ในแต่ละ L2 domain', 'ลอง What-if Users 100 → 250 และตรวจ subnet ที่ต้อง resize'],
  }),
  finalize({
    id: 'branch-hq', name: 'Branch ↔ HQ · Routed Network', tone: 'cyan',
    description: 'LAN สาขาและสำนักงานใหญ่ พร้อม WAN transit /30 และ scenario ตรวจการส่งไป server ส่วนกลาง',
    useCase: 'เตรียม addressing สำหรับสอง site และตรวจผลกระทบเมื่อ WAN link ขาด',
    plan: { parent: '10.60.0.0/16', segments: [segment('hq', 'HQ LAN', 'HQ', 10, '10.60.10', 100), segment('branch', 'Branch LAN', 'Branch', 10, '10.60.20', 50), { id: 'wan', name: 'WAN Transit', site: 'WAN', department: 'Transit', vlan: 100, hosts: 1, growth: 0, reservedCount: 0, cidr: '10.60.255.0/30', gateway: '10.60.255.1', reservedIps: [] }], assignments: [{ segmentId: 'wan', ip: '10.60.255.2', kind: 'device', label: 'Branch WAN interface (configure on real router)', mac: '' }] },
    nodes: [node('branch-pc', 'pc', 'Branch Staff PC', '10.60.20.10', 10, 70, 180, '10.60.20.1'), node('branch-printer', 'printer', 'Branch Printer', '10.60.20.30', 10, 70, 390, '10.60.20.1'), node('branch-sw', 'switch', 'Branch Switch', '10.60.20.2', 10, 300, 290, '10.60.20.1'), node('branch-r', 'router', 'Branch Router', '10.60.20.1', 10, 510, 290, '', 'Real WAN interface 10.60.255.2/30; route HQ LAN via 10.60.255.1'), node('hq-r', 'router', 'HQ Router', '10.60.10.1', 10, 720, 290, '', 'Real WAN interface 10.60.255.1/30; route Branch LAN via 10.60.255.2'), node('hq-sw', 'switch', 'HQ Switch', '10.60.10.2', 10, 940, 290, '10.60.10.1'), node('hq-app', 'server', 'HQ ERP / App', '10.60.10.20', 10, 940, 110, '10.60.10.1'), node('hq-admin', 'pc', 'HQ Admin PC', '10.60.10.10', 10, 940, 480, '10.60.10.1')],
    edges: [link('branch-access', 'branch-pc', 'branch-sw'), link('branch-printer-access', 'branch-printer', 'branch-sw'), link('branch-up', 'branch-sw', 'branch-r'), link('wan-link', 'branch-r', 'hq-r', 'WAN 10.60.255.0/30', { medium: 'fiber', bandwidth: '100 Mbps' }), link('hq-up', 'hq-r', 'hq-sw'), link('hq-app-access', 'hq-sw', 'hq-app'), link('hq-admin-access', 'hq-sw', 'hq-admin')],
    scenarios: [scenario('branch-ping', 'Branch → HQ ERP · ICMP', 'branch-pc', 'hq-app'), scenario('branch-app', 'Branch → HQ ERP · TCP 443', 'branch-pc', 'hq-app', 'TCP'), scenario('wan-failure', 'WAN down · expected Failed', 'branch-pc', 'hq-app', 'ICMP', { expected: 'failed', disabledEdges: ['wan-link'], note: 'ปิด WAN เฉพาะ scenario นี้ ไม่แก้ topology ที่บันทึก' }), scenario('branch-local', 'Branch → Printer · local LAN', 'branch-pc', 'branch-printer')],
    checklist: ['กำหนด WAN IP /30 บน interfaces จริงและ static routes หรือ routing protocol ตามอุปกรณ์', 'ติดตั้ง Probe ที่ HQ LAN และ Branch LAN; ไม่ใช้ ICMP จาก cloud แทน Probe ของแต่ละ site', 'ตรวจ WAN ด้วย host probe/traceroute จาก Probe ที่เข้าถึง subnet นั้นได้', 'ทดสอบ WAN down scenario เพื่อเทียบกับปัญหาการเชื่อมต่อจริง'],
  }),
  finalize({
    id: 'server-rack', name: 'Server Rack · Primary / Backup', tone: 'green',
    description: 'เครือข่าย server กับ management แยก subnet พร้อม uplink สำรองและ scenario failover',
    useCase: 'ตรวจเส้นทาง Admin → App/DB และทดลองผลของ uplink หลักขัดข้อง',
    plan: { parent: '10.70.0.0/16', segments: [segment('production', 'Production Servers', 'DC', 10, '10.70.10', 60), segment('management', 'Management', 'DC', 99, '10.70.99', 20)], assignments: [] },
    nodes: [node('rack-admin', 'pc', 'Admin Workstation', '10.70.99.10', 99, 60, 290, '10.70.99.1'), node('rack-mgmt', 'switch', 'Management Switch', '10.70.99.2', 99, 270, 290, '10.70.99.1'), node('rack-gw', 'router', 'DC Gateway', '10.70.99.1', 99, 490, 290, '', 'Real gateway interfaces: 10.70.99.1 and 10.70.10.1'), node('rack-primary', 'switch', 'Primary Switch', '10.70.10.2', 10, 710, 160, '10.70.10.1'), node('rack-backup', 'switch', 'Backup Switch', '10.70.10.3', 10, 710, 490, '10.70.10.1'), node('rack-app', 'server', 'Application Server', '10.70.10.10', 10, 970, 160, '10.70.10.1', 'Dual path reference; configure NIC teaming/active-backup on actual hardware'), node('rack-db', 'server', 'Database Server', '10.70.10.20', 10, 970, 360, '10.70.10.1', 'TCP 5432 is a simulated service, not a database connection'), node('rack-backup-host', 'server', 'Backup Repository', '10.70.10.30', 10, 970, 560, '10.70.10.1')],
    edges: [link('rack-admin-link', 'rack-admin', 'rack-mgmt'), link('rack-mgmt-up', 'rack-mgmt', 'rack-gw'), link('rack-primary-up', 'rack-gw', 'rack-primary', 'Primary uplink', { medium: 'fiber', bandwidth: '10 Gbps' }), link('rack-backup-up', 'rack-gw', 'rack-backup', 'Standby uplink', { medium: 'fiber', bandwidth: '10 Gbps', status: 'inactive' }), ...['app', 'db', 'backup-host'].flatMap(v => [link(`rack-primary-${v}`, 'rack-primary', `rack-${v}`, 'Primary access'), link(`rack-secondary-${v}`, 'rack-backup', `rack-${v}`, 'Backup access')])],
    scenarios: [scenario('rack-app-test', 'Admin → App · TCP 443', 'rack-admin', 'rack-app', 'TCP'), scenario('rack-db-test', 'App → DB · TCP 5432', 'rack-app', 'rack-db', 'TCP', { destinationPort: 5432 }), scenario('rack-failover', 'Primary down / Backup up · ICMP', 'rack-admin', 'rack-app', 'ICMP', { disabledEdges: ['rack-primary-up'], enabledEdges: ['rack-backup-up'], note: 'สลับเส้นทางเฉพาะ scenario; ไม่ได้จำลอง LACP/STP convergence' }), scenario('rack-no-uplink', 'Both uplinks down · expected Failed', 'rack-admin', 'rack-app', 'ICMP', { expected: 'failed', disabledEdges: ['rack-primary-up', 'rack-backup-up'] })],
    checklist: ['กำหนด gateway ของ production/management และ policy ระหว่างสอง subnet บน hardware', 'ตั้ง redundant uplinks/NIC teaming จริงตามอุปกรณ์ ไม่ใช้ผล model แทน STP/LACP test', 'รัน Probe แยก production และ management แล้วเพิ่ม expected MAC ของ server จริงใน IPAM', 'ใช้ Primary down scenario เทียบเส้นทางสำรอง ก่อนทำ change ใน maintenance window'],
  }),
]

export function instantiateTemplate(template, suffix) {
  const ids = new Map(template.nodes.map(n => [n.id, `${n.id}-${suffix}`]))
  return {
    nodes: template.nodes.map(n => ({ ...n, id: ids.get(n.id), position: { ...n.position }, data: { ...n.data } })),
    edges: template.edges.map(e => ({ ...e, id: `${e.id}-${suffix}`, sourceNodeId: ids.get(e.sourceNodeId), targetNodeId: ids.get(e.targetNodeId) })),
    plan: JSON.parse(JSON.stringify(template.plan)),
    info: { id: template.id, name: template.name, useCase: template.useCase, checklist: [...template.checklist], mode: 'Realtime', scenarios: template.scenarios.map(s => ({ ...s, source: ids.get(s.source), target: ids.get(s.target), disabledEdges: (s.disabledEdges || []).map(id => `${id}-${suffix}`), enabledEdges: (s.enabledEdges || []).map(id => `${id}-${suffix}`) })) },
  }
}

export function scenarioTopology(topology, scenario) {
  const disabled = new Set(scenario.disabledEdges || []), enabled = new Set(scenario.enabledEdges || [])
  return { nodes: topology.nodes, edges: topology.edges.map(e => ({ ...e, status: disabled.has(e.id) ? 'inactive' : enabled.has(e.id) ? 'active' : e.status })) }
}
