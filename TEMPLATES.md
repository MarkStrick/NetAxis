# Realtime reference templates

หน้าแรก → Templates → เปิดรายละเอียด → ใส่ชื่อที่แสดง → ใช้ Template

ระบบสร้างห้องพร้อม topology, IPAM และ scenarios ใน transaction เดียว แล้วเปิด Simulator ใน Realtime เลือก **Ready scenario → Run Scenario** เพื่อเล่น packet events อัตโนมัติ ดูผลใน PDU List, Event List และ PDU Information ใช้ Pause หรือ Simulation เพื่อดูทีละ event; Reset เพื่อล้างคิว

ห้อง Template มีอายุ 24 ชั่วโมงนับจากเวลาสร้าง ดูเวลาที่เหลือด้านบน และกด **Backup** ก่อนหมดอายุเพื่อเก็บ Topology, IPAM และ scenarios ทั้งหมด กู้คืนได้จากหน้าแรก → กู้คืน Workspace จากไฟล์ → เปิดเป็นห้องใหม่ 24 ชั่วโมง การเข้าซ้ำหรือเปิด scenario ไม่ต่ออายุห้องเดิม

| Template | ใช้กับงาน | Subnets | Scenarios |
| --- | --- | --- | --- |
| Small Office · Ready LAN | สำนักงาน 50 users, Wi-Fi, printer, server | 10.50.0.0/24 | PC↔Server, TCP443, Printer TCP9100, Wi-Fi↔Server |
| Office · Users / Servers / Guest | แบ่ง Users / Servers / Guest และวางแผนขยาย | 10.51.10.0/24, 10.51.20.0/24, 10.51.30.0/24 | routed TCP443, UDP53, Guest↔Guest, Users ARP |
| Branch ↔ HQ · Routed Network | สอง site เชื่อม WAN /30 | 10.60.10.0/24, 10.60.20.0/24, 10.60.255.0/30 | ICMP/TCP ไป HQ, WAN down, printer ในสาขา |
| Server Rack · Primary / Backup | แยก production / management และทดสอบเส้นทางสำรอง | 10.70.10.0/24, 10.70.99.0/24 | App TCP443, DB TCP5432, primary down / backup up, both uplinks down |

IP/CIDR/VLAN กำหนดให้ทุก node; gateway อยู่ใน notes และแผน subnet มี growth, gateway, reserved addresses และ assignments เปิด **IP Planning** เพื่อแก้ IP ตัวอย่าง Calculate/Validate หรือทดลอง What-if เช่น Users 100 → 250

Scenario WAN down และ both uplinks down ควรได้ Failed ส่วน primary down / backup up ควร Successful การเปลี่ยน link สำหรับ scenario มีผลเฉพาะการจำลอง ไม่เปลี่ยน topology ที่บันทึก ห้องและ scenario เปิดกลับมาใช้ได้หลัง restart server

## นำไปใช้กับเครือข่ายจริง

1. เลือก addressing ให้ตรงกับ site และตรวจ overlap/capacity ก่อนติดตั้ง
2. กำหนด IP, mask, gateway, VLAN, routes และ policy บน hardware ตาม checklist ในรายละเอียด Template Router ที่เชื่อมหลาย subnet ต้องมี interface/gateway ของแต่ละ subnet บนอุปกรณ์จริง
3. ใส่ MAC จริงของอุปกรณ์ใน IPAM ที่ต้องการตรวจ mismatch Template เว้น MAC ไว้ เพราะ MAC ที่ Simulator สร้างเป็นข้อมูลจำลอง
4. เพิ่ม Probe ในแต่ละ segment ผ่าน IP Planning → Live Verify และรัน agent ในเครือข่ายนั้น ดู [PLANNING.md](PLANNING.md)
5. ส่งงาน ping/neighbor/host/traceroute ตามต้องการ แล้วเทียบ Planned กับ Observed เพื่อดู Unexpected, Missing/Down, Reserved conflict, MAC mismatch และ Capacity risk

Realtime เป็นการเล่น model อัตโนมัติ ไม่ส่ง traffic ไป hardware TCP/UDP service และเส้นทาง router เป็นสมมติฐานของ model ไม่มี IOS CLI, per-interface routing table, ACL/NAT หรือ STP/LACP convergence UDP53 ไม่ resolve DNS จริง และ failover scenario เป็นการเลือกเส้นทางสำรองสำหรับตรวจ design ตรวจผลการติดตั้งจริงด้วย Probe และเครื่องมือของอุปกรณ์
