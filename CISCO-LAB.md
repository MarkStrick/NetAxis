# Cisco CLI Lab — รันใน browser

เปิดห้อง → กด **Cisco CLI** บน Canvas → เลือก Router หรือ Switch

NetAxis ใช้ CLI parser/executor และ routing/config helpers ของ **Cisco Real Sim** (Networkers Home, MIT) ภายใน Web Worker ไม่มี GNS3, Console Gateway, IOS Image หรือ Server เพิ่ม ระบบห้องและ API เดิมใช้เฉพาะการบันทึก/ซิงก์โปรเจกต์

## ตัวอย่าง

พอร์ตบน Canvas `G0/0` ใช้กับ CLI ได้โดยตรง หรือพิมพ์ชื่อเต็ม `GigabitEthernet0/0`:

```text
enable
configure terminal
interface G0/0
ip address 10.0.0.1 255.255.255.0
no shutdown
end
show ip interface brief
ping 10.0.0.2
```

ต้องมีอุปกรณ์ปลายทางที่ใช้ IP นั้นบน Canvas และต่อสาย/กำหนด VLAN ให้ถูกต้อง หากข้าม Router ใช้ Static Route ตามตัวอย่าง:

```text
configure terminal
ip route 10.2.0.0 255.255.255.0 10.0.12.2
end
show ip route
```

Switch รองรับ `vlan 10`, `switchport mode access`, `switchport access vlan 10`, `switchport mode trunk` และ `switchport trunk allowed vlan ...` เลือกพอร์ตที่มีอยู่ในรุ่นบน Canvas เท่านั้น ไม่สร้าง Loopback/SVI/Subinterface เพิ่มโดยเงียบ ๆ

`?` แสดง help, Tab ช่วยเติมชื่อคำสั่ง และปุ่มลูกศรขึ้น/ลงเรียกประวัติ ข้อความจาก Engine แสดงเป็น plain text ไม่มีการรันคำสั่ง shell หรือส่ง packet ออกเครื่องจริง

## บันทึกและทำงานร่วมกัน

- Config เป็น draft ภายใน browser จนกด **บันทึก Config ลงโปรเจกต์**; ขณะมี draft ต้องบันทึกหรือทิ้งก่อนเปลี่ยนอุปกรณ์
- การบันทึกใช้ API/revision/สิทธิ์ owner/editor เดิม และอัปเดต IP, พอร์ต, VLAN, hostname และ routing metadata ของ Node ใช้ร่วมกับ Simulator ได้
- หากสมาชิกอื่นเปลี่ยน Topology ระหว่างแก้ draft ปุ่มบันทึกถูกปิด ต้องโหลดใหม่เพื่อไม่เขียนทับงานของผู้อื่น ปิดหน้าต่างหรือโหลดใหม่จะเตือนก่อนทิ้ง draft
- Viewer ใช้ show/ping และเปลี่ยน CLI mode ส่วนตัวได้ แต่ตั้งค่า/บันทึก Config ไม่ได้
- Backup/Restore Workspace และ Undo/Redo เก็บ Config CLI ไปกับ Node; ID ของห้องใหม่เปลี่ยนได้เพราะคำสั่งไม่ผูกกับ Project/Device ของ Server ภายนอก
- `write memory` / `copy running-config startup-config` เก็บ startup command configuration ในโมเดล ไม่แทนปุ่มบันทึกลงโปรเจกต์
- หากแก้ Properties หลังใช้ CLI ค่าพอร์ต/ชื่อบน Canvas มีผลก่อนค่าเดิมในประวัติ CLI Connected routes คำนวณจากพอร์ตปัจจุบัน ส่วน Static Routes ยังต้องตรวจว่ามี next hop ที่เข้าถึงได้

## Engine และขอบเขต

Core ที่ vendored มาจาก commit `64fa44b03a9273886e61e6db2b88ebcc6e451b4f` ของ https://github.com/NETWORKERS-HOME-123/cisco-real-sim มี license และ provenance ใน `src/client/vendor/cisco-real-sim/` นำเฉพาะ core มาใช้ ไม่ติดตั้ง Next.js/React หรือ backend ของโครงการต้นทาง และไม่เพิ่ม dependency สำหรับ UUID (ใช้ nanoid ที่มีอยู่)

Scenario ส่วนตัว, Simulator ที่แชร์ในห้อง และ Ping จาก CLI ใช้ตัวส่ง Packet `buildCiscoPdu` ร่วมกัน การตัดสินเส้นทางอิงหลัก IPv4 ของ Cisco แต่ไม่ใช้ Packet Tracer engine หรือผล Ping สำเร็จรูปจาก Lib ตัว upstream มี shortcut ใน routing จึงใช้ CLI core สำหรับ Config แล้วตรวจ forwarding แยกจากนั้น

- Host ส่งภายใน subnet โดยตรง ต่าง subnet ต้องมี default gateway ที่อยู่ใน subnet และเข้าถึงได้ใน VLAN
- Router เลือก Connected/Static/Default Route ด้วย longest prefix และส่งออกพอร์ตที่กำหนด ต้องมี IP และ link ขึ้น ไม่เลือกเส้นทางจากการมีสายถึงปลายทางอย่างเดียว
- ARP หา IP ของ next hop ด้วย interface IP ของแต่ละ segment; Router เปลี่ยน Ethernet headers, คง IP ของต้นทาง/ปลายทาง และลด TTL
- ICMP/TCP/HTTP ต้องมีเส้นทางขากลับ UDP ตรวจการส่งขาเดียว และ ACL ใช้ทั้งสองทิศตามโมเดล stateless เดิม
- TCP/UDP/HTTP ต้องเปิด listening service ใน Properties ไม่มีการเดา service ให้ ตัวอย่างใหม่ตั้ง services/gateways/interface IP/static routes ไว้ในข้อมูลโปรเจกต์
- เปิด uplink สำรองอย่างเดียวไม่ถือว่า routing/NIC failover สำเร็จ ตัวอย่าง Server Rack ที่ไม่มี NIC teaming จะรายงาน Failed; Dual Campus เป็นผังอ้างอิงที่ยังขาด SVI/subinterfaces และ routing config จึงแสดง Expected Failed พร้อมสาเหตุ ไม่จำลองว่า GRE/OSPF/STP ทำงานแล้ว

ห้องหรือไฟล์เก่าที่เคยผ่านโดยอาศัยการเดา Config อาจเปลี่ยนเป็น Failed ต้องเพิ่ม Gateway, IP แต่ละ interface, route และ service ให้ครบ ไม่มีการย้ายหรือแก้ข้อมูลห้องเก่าอัตโนมัติ ตัวส่ง `buildPdu` เก็บไว้สำหรับทดสอบความเข้ากันได้ของโมเดลเดิม หน้ารัน Scenario และ CLI ใช้ `buildCiscoPdu` เสมอ

หลักการอ้างอิง: [Cisco Route Selection](https://www.cisco.com/c/en/us/support/docs/ip/enhanced-interior-gateway-routing-protocol-eigrp/8651-21.html), [Cisco ARP](https://www.cisco.com/c/en/us/td/docs/routers/ios-xe/ip-addressing/ip-addressing/m_arp-config-arp-0.html)

รองรับชุดพื้นฐาน: hostname, Interface IPv4, shutdown/no shutdown, description, VLAN/access/trunk, Static Route, ip routing/no ip routing, show และ Ping จำกัดประวัติ Config 250 คำสั่งต่ออุปกรณ์ คำสั่งที่ไม่อยู่ในชุดที่ทดสอบจะถูกปฏิเสธ ไม่แสดงผลว่าทำงานสำเร็จ

ยังไม่ใช่ IOS emulator หรือ Packet Tracer engine ของ Cisco ไม่รองรับครบทุก IOS command, OSPF/BGP/NAT/DHCP configuration ผ่าน CLI, SVI/subinterfaces, MAC learning/STP convergence, recursive next-hop/ECMP, reload/boot จริง หรือสถานะ protocol แบบ hardware บางคำสั่ง show ที่ upstream มีอาจแสดง state ว่างสำหรับฟีเจอร์ที่ยังไม่เปิดใช้

`npm run check` ตรวจ CLI/route/Ping, shutdown/VLAN/ACL, validation, viewer, draft conflicts, Cloud persistence และ Workspace restore ผ่านระบบเดิม ทดสอบ local ด้วย Node 22; Node 24 bundled ในเครื่องนี้เคยพบ native crash ของ better-sqlite3 เดิม
