# NETAXIS Packet Simulator

เปิดห้อง แล้วกด **Simulation** บน canvas toolbar แผง Simulator ใช้ flow แบบ Packet Tracer: Realtime / Simulation, Simple PDU, Event List, protocol filters, Capture / Forward, Auto Capture / Play และ PDU Information

## วิธีใช้

1. กำหนด IPv4/CIDR ของ endpoint และเชื่อมอุปกรณ์ด้วย active links
2. กด **Add Simple PDU** แล้วคลิกอุปกรณ์ต้นทางและปลายทางบน canvas หรือ sidebar รายการอุปกรณ์ สามารถเลือกผ่าน keyboard Enter/Space บน node ได้ กด Escape ยกเลิก
3. ใน Simulation mode ใช้ **Capture / Forward** เพื่อประมวลผลทีละ event หรือ **Auto Capture / Play** เพื่อเล่นต่อเนื่อง **Pause** หยุดตรงตำแหน่งแพ็กเก็ตปัจจุบัน
4. Event List แสดง simulated time, last device, at device และ protocol/action กด event หรือซองแพ็กเก็ตบน canvas เพื่อดูรายละเอียด ระบบจะ pause ขณะ inspect
5. **OSI Model** แสดง L1–L7 ส่วน **Inbound / Outbound PDU Details** แสดง Ethernet/IPv4, MAC, IP, TTL, TCP/UDP ports, flags และ sequence/ack เมื่อเกี่ยวข้อง
6. Filter ARP/ICMP/TCP/UDP เปลี่ยนเฉพาะ events ที่แสดง การจำลองยังประมวลผล events ทั้งหมด
7. **Back** ถอยหนึ่ง event; **Replay** เริ่ม scenario เดิมจากศูนย์; **Reset Simulation** ล้าง PDU/Event/ARP table ทั้งหมด

Realtime mode เล่นคิว PDU อัตโนมัติในโมเดลนี้ ใช้ **IP Planning → Live Verify** และ segment Probe สำหรับตรวจเครือข่ายจริง

ปุ่ม **Pause / Resume** และ **Stop / Reset** อยู่ส่วนบนของแผงและติดอยู่ขณะเลื่อน Pause เก็บตำแหน่ง packet และคิวให้เล่นต่อได้ Stop / Reset ยกเลิก animation และล้าง PDU/Event/ARP table ปิด Simulator จะหยุด animation และกลับไปยัง canvas เดิม โดยคง Node, Link และตำแหน่งมุมมองไว้ การเปิดใหม่เริ่มด้วยคิวว่าง

## Protocol model

- **ICMP / Simple PDU:** ARP resolve next hop ตามด้วย Echo Request และ Echo Reply ความสำเร็จเกิดเมื่อ reply กลับถึง source
- **ARP:** Broadcast request ใน L2 domain, อุปกรณ์ที่ไม่ใช่ target เพิกเฉย และ unicast reply กลับผ่าน bridge แสดง learned entries ใน simulated ARP table PDU ถัดไปใช้ cache ได้ Explicit ARP PDU ยังคงสร้าง request ใหม่
- **TCP / Complex PDU:** SYN → SYN-ACK → ACK → PSH/ACK data → ACK กำหนด destination port และ payload bytes ได้ บริการปลายทางถือว่ามีอยู่ในโมเดล
- **UDP / Complex PDU:** Datagram ทางเดียวถึง destination โดยไม่สร้าง ACK การถึงปลายทางของโมเดลไม่ยืนยัน application delivery
- **TTL:** ลดเมื่อผ่าน transit router/firewall/Internet node TTL หมดจะ drop พร้อมเหตุผล ไม่สร้าง ICMP Time Exceeded ต่อ
- **Path checks:** ไม่ผ่าน inactive links/offline devices ไม่ใช้งาน PC/server/printer เป็น transit router ต่าง subnet/VLAN ต้องมี modeled L3 path Endpoints ต้องมี IPv4/CIDR ที่ใช้ได้ และไม่ใช้ network/broadcast IP

เวลาของ event เป็น logical time ไม่ใช่ latency จริง Frame animation ปรับ 0.5x–4x ได้ และลด motion เมื่อ OS ขอ reduced motion สถานะ Successful/Failed เป็นผลของ PDU ทั้ง transaction ไม่ใช่จำนวน link hops

## ขอบเขต

เป็น educational topology model ไม่ใช่ Cisco Packet Tracer engine หรือ IOS emulator ไม่มี IOS CLI, routing table/protocol, per-interface addressing, ACL, NAT, DHCP/DNS/application services จริง รวมถึงไม่ได้จำลอง STP, collision, congestion หรือ packet loss แบบ probabilistic ARP flood ใช้ spanning-tree traversal เพื่อหยุด loop Bridge ไม่แก้ TTL และ L3 hop เปลี่ยน Ethernet sender/next-hop MAC ตามโมเดล

IPv4 ของแต่ละ node ใช้เป็นข้อมูลระดับอุปกรณ์ เมื่อผ่าน router หลาย interface ข้อมูล IP/interface จริงอาจไม่ตรงกับโมเดลนี้ ไม่มีการสร้าง interface configuration ที่ยังไม่ได้บันทึก MAC ที่ไม่ได้ระบุสร้างเป็น locally administered simulation MAC และระบุชัดใน PDU Details ไม่ใช่ MAC ที่ Probe ตรวจพบ

รองรับ 10 PDUs / 6000 events ต่อ scenario การเปลี่ยน config/status/connectivity ของ topology จะล้าง scenario ป้องกันการใช้เส้นทางเก่า การเลื่อนตำแหน่ง node อย่างเดียวไม่เปลี่ยน network model Viewer ใช้ Simulator ได้โดยไม่แก้ topology หรือส่ง traffic จริง

แผงอยู่ข้าง canvas บนจอใหญ่และด้านล่างบนจอเล็ก ปิดแผงเพื่อกลับ Properties panel

## Verification

Unit/component tests ตรวจ ARP broadcast/cache, ICMP round trip, TCP sequence/handshake, UDP, TTL/MAC rewrite, invalid network paths, protocol filters, capture/back/replay/reset, auto pause/realtime และการเลือก PDU ผ่าน canvas โดยไม่เขียนข้อมูล server

อ้างอิง workflow: [Cisco Networking Academy — Explore Network Functionality Using PDUs](https://contenthub.netacad.com/legacy/I2PT/1.1/en/course/files/3.1.1.3%20Packet%20Tracer%20-%20Explore%20Network%20Functionality%20Using%20PDUs.pdf), [Packet Tracer Help — PDU Information](https://tutorials.ptnetacad.net/help/default/mode_simulation_PDUinfo.htm)
