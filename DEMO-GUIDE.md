# NetAxis · เดโมพรีเซนต์อาจารย์

เปิดหน้า Templates เลือก Cisco Lab และสร้างห้อง ปุ่ม **นำเสนอเดโม** ในห้องแสดงลำดับอธิบาย เปิด CLI และรันการทดสอบได้จากจุดเดียว ผลที่เห็นคำนวณจาก Config ปัจจุบัน ไม่ใช่วิดีโอหรือผลที่ใส่ไว้ล่วงหน้า

## เดโมหลัก 5–7 นาที: Branch ↔ HQ

1. เปิด **03 · Branch ↔ HQ — Static Route** แนะนำ ISR 4331 สองตัวและ Catalyst C9200L สองตัว LAN เป็น 10.60.20.0/24 และ 10.60.10.0/24 ส่วน WAN เป็น 10.60.255.0/30
2. กด **ดู Cisco CLI** เลือก R-BRANCH พิมพ์ `enable`, `show ip interface brief`, `show ip route` อธิบาย connected route กับ static route ไป HQ ผ่าน 10.60.255.1 เปลี่ยนไป R-HQ เพื่อแสดงเส้นทางกลับผ่าน 10.60.255.2
3. กด **รันเดโมนี้** ข้อ Ping คาดว่า Successful ดู ARP ของ next hop แล้ว ICMP ขาไป/กลับ สามารถ Pause และก้าวทีละ event ได้
4. เลือก HTTP คาดว่า Successful แสดง TCP handshake แล้ว HTTP request/response; ฝั่ง HQ Server เปิด HTTP 80 ไว้ชัดเจน
5. เลือก WAN down คาดว่า Failed อธิบายสาเหตุ route/ARP ไม่สามารถถึง HQ จากนั้นเลือก LAN สาขาขณะ WAN down ซึ่งควร Successful
6. กลับไป Ping ปกติให้ผ่านอีกครั้ง การปิดสายเฉพาะ Scenario ไม่แก้ผังที่บันทึก

ถ้าต้องการสาธิตการแก้ Config: เข้า CLI ของ R-BRANCH → `configure terminal` → `no ip route 10.60.10.0 255.255.255.0 10.60.255.1` → `end` แล้วกดบันทึก Config รัน Ping อีกครั้งจะไม่ผ่าน เพิ่ม route เดิมด้วย `ip route 10.60.10.0 255.255.255.0 10.60.255.1` และบันทึก เพื่อให้กลับมาผ่าน การแก้ผ่าน CLI ต้องบันทึกก่อน Scenario จึงใช้ค่าที่แก้

## เดโมอื่น

| Lab | สิ่งที่อธิบาย | ผลที่ควรได้ |
|---|---|---|
| 01 Cisco LAN | พอร์ตจริง, Access VLAN 10, ARP และ ICMP echo/reply | PC→Server และ Printer ผ่าน; สาย Server ขาดไม่ผ่าน |
| 02 VLAN / Trunk | Access VLAN 10/20, SFP trunk ระหว่างสองสวิตช์, routed interfaces แยก subnet | VLAN 10 ข้าม trunk และข้าม VLAN ผ่าน router ได้; trunk ขาดไม่ผ่าน |
| 04 Services | HTTP, TCP 5432 และ UDP 53 | service ที่เปิดไว้ผ่าน; TCP 22 ที่ไม่มี listener ไม่ผ่าน |

ใน Lab 02 ใช้ physical router interface สองช่องต่อ access VLAN 10 และ 20 ไม่ใช้ router-on-a-stick, SVI หรือ subinterface ที่ระบบยังไม่รองรับ เหมาะกับการอธิบายหลัก routing ก่อนต่อยอด

## ไฟล์สำหรับเตรียมก่อนพรีเซนต์

ในโฟลเดอร์ `demos/` มี Workspace JSON และคำสั่ง CLI แยกสำหรับทั้ง 4 Lab นำ JSON เข้า **กู้คืน Workspace จากไฟล์** บนหน้าเว็บได้ เก็บไฟล์ไว้ก่อนวันนำเสนอเพราะห้องมีอายุ 24 ชั่วโมง ไฟล์ `promo/NETAXIS_DEMO_WORKSPACE.json` เปลี่ยนเป็น Branch/HQ ชุดใหม่แล้ว

- [LAN Workspace](demos/cisco-lan-demo.json) · [CLI](demos/cisco-lan-demo-cli.txt)
- [VLAN Workspace](demos/cisco-vlan-trunk-demo.json) · [CLI](demos/cisco-vlan-trunk-demo-cli.txt)
- [Branch/HQ Workspace](demos/cisco-branch-demo.json) · [CLI](demos/cisco-branch-demo-cli.txt)
- [Services Workspace](demos/cisco-services-demo.json) · [CLI](demos/cisco-services-demo-cli.txt)

## ขอบเขตและหลักฐาน

Router/Switch ใช้รุ่นจริงจาก catalog และ Config ในไฟล์สร้างโดยส่งคำสั่งผ่าน `createCiscoLab` ตัวเดียวกับ CLI ของเว็บ ไม่ได้แค่ใส่ข้อความคำสั่งประกอบผัง PC/Server/Printer ตั้ง IP, gateway และ listening service ผ่านข้อมูลอุปกรณ์ ไม่ได้ใช้ IOS ตั้งค่าเครื่องปลายทาง

ตัวสร้างเทมเพลตตรวจคำสั่งผิด ตรวจ addressing/พอร์ต และรันทุก Scenario ทั้งสำเร็จและล้มเหลวก่อนเขียนไฟล์ Tests ตรวจว่า Config ที่สร้างใหม่ตรงกับ snapshot ที่เว็บใช้ รวมถึงสร้างห้อง Save/Load และ restore ไฟล์บน backend ทั้งสองแบบ

อ้างอิงหลักคำสั่ง [Cisco VLAN / Trunk](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9200/software/release/17-14/configuration_guide/vlan/b_1714_vlan_9200_cg/configuring_vlan_trunks.html) และ [Cisco IP Routing Configuration](https://www.cisco.com/c/en/us/td/docs/routers/ios-xe/ip-routing/b-ip-routing.pdf)

นี่เป็น Cisco-style IPv4 simulation ในเบราว์เซอร์ ไม่ใช่ Cisco IOS หรือ Packet Tracer ของ Cisco ไม่มี dynamic routing/STP/SVI/NAT, RF, PoE, throughput, TLS หรือ DNS record resolution; UDP 53 แสดง transport ไม่ได้แก้ชื่อ DNS จริง ไม่มีการทดสอบบนอุปกรณ์จริงจากงานนี้
