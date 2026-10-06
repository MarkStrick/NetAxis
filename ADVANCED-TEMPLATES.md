# Template TCP / UDP และ Advanced

เลือก Template ที่หน้าแรกเพื่อสร้างห้องพร้อมอุปกรณ์ สาย IPAM และ Scenario จากนั้นเปิด Simulator → เลือก Scenario → Run Scenario ใช้โหมดร่วมกันในห้องเพื่อให้สมาชิกดูการรันเดียวกันได้

| Template | ใช้เรียนรู้และทดลอง |
| --- | --- |
| TCP Lab · Web / App / Database | Client → Web 443, Web → API 8443, App → Database 5432, Admin → SSH 22, API uplink สำรอง, DB ขาด และ TTL หมด |
| UDP Lab · DNS / NTP / Syslog | DNS 53, NTP 123, Syslog 514, Media datagram 5004, TCP DNS 53 เพื่อเทียบ handshake, uplink ขาดและ TTL หมด |
| Advanced · Dual Campus / 10 VLANs | Ufone / Jazz, VLAN 10–100, Edge, L3 Core/Distribution, Access, Server Farm, ISP/service reference, TCP/UDP ข้ามไซต์, WAN ขาดและ logical failover |

TCP แสดง SYN / SYN-ACK / ACK และ data/ACK ส่วน UDP แสดง datagram ไปถึงปลายทางโดยไม่มี ACK เปิด Event List และ PDU Information เพื่อตรวจ flags, port, TTL และเส้นทางได้ การเลือกชื่อบริการหรือ port ไม่ได้เปิดบริการนั้นจริง: ไม่มี TLS/HTTP/SQL/DNS/NTP/Syslog/DHCP server ใน Simulator

แบบสองไซต์อิงโครงสร้างภาพที่ให้มา ใช้ private addressing 10.80.0.0/16 แทน public IP เพื่อไม่ชวนให้ใช้ IP ที่ไม่มีสิทธิ์ ทุก VLAN มี subnet/gateway/reserved IP และ assignments ที่บันทึกใน IPAM มีผู้ใช้ 10 เครื่อง, Access 6 ตัว และ Server Farm สองฝั่ง

L3 Core และ Distribution แสดงเป็น router node เพื่อใช้ forwarding model ปัจจุบัน Notes ระบุ design intent OSPF ฝั่ง Ufone และ EIGRP ฝั่ง Jazz แต่ยังไม่มี IOS CLI, adjacency หรือ routing protocol convergence ใน engine เส้น GRE เป็น logical link ที่เปิดใน Scenario failover โดยไม่มี GRE encapsulation หรือ keepalive ชื่อ interface บนสายเป็นป้ายประกอบภาพ ไม่ใช่ per-interface configuration

สำหรับ network จริงต้องกำหนด SVI, routing, ACL/NAT, redundant links และบริการบน hardware แล้วติดตั้ง Probe ในแต่ละ VLAN/site เพื่อเทียบ Planned กับ Observed Network
