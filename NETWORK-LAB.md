# Network Lab

อุปกรณ์บน Canvas และ Palette ใช้ SVG ของ PC, Server, Router ทรงสีน้ำเงินแบบแผนภาพ Cisco, Switch, AP, Firewall, Printer และ Cloud สามารถซูมได้โดยภาพยังคมชัด รุ่นในรายการเป็น **รุ่นจำลองสำหรับ Lab** ไม่ใช่การรับรองสเปกหรือ IOS ของ Cisco

## ออกแบบและตรวจ Network

1. ลากหรือคลิกอุปกรณ์จาก Palette เลือก Device model เพื่อดู Layer และจำนวนพอร์ต
2. กดพอร์ตใน Properties เพื่อกำหนด up/down, access VLAN, trunk allowed VLANs หรือ IPv4 ของ interface ที่เป็น Layer 3
3. ลากสายหรือใช้โหมดเชื่อมต่อ เลือก source/target port ก่อนบันทึก พอร์ตที่ใช้แล้วไม่สามารถต่อสายซ้ำได้ และไม่สามารถเปลี่ยนเป็นรุ่นที่ทำให้สายเดิมใช้พอร์ตที่ไม่มีอยู่
4. เปิด VLAN เพื่อดูสมาชิกและ VLAN ที่ผ่านสายแต่ละเส้น กด Validate เพื่อตรวจ IP ซ้ำ, network/broadcast address, gateway, พอร์ต และ VLAN
5. เปิด Simulation เลือกต้นทาง ปลายทาง และ ICMP/Ping, ARP, TCP, UDP หรือ HTTP จากนั้นเล่น Realtime หรือ Capture ทีละขั้น ดู Event List และข้อมูล PDU ได้
6. เพิ่ม Firewall / ACL ใน Properties กฎตรวจตามลำดับและตรวจทั้งขาไป/กลับ แบบ stateless กฎ TCP ใช้กับ HTTP ด้วย กฎ HTTP ใช้กับ traffic port 80 กฎที่ Deny หยุด PDU ที่อุปกรณ์นั้นพร้อมเหตุผล ส่วน Services ระบุ HTTP server และ TCP/UDP listening ports ได้

Simulator เป็นแบบจำลองเพื่อการเรียนรู้: ตรวจพอร์ต, access/trunk VLAN, gateway ที่กำหนด, ACL, service และเส้นทางตอบกลับ จำลอง TCP handshake และ HTTP GET/200 แต่ไม่ได้รันระบบปฏิบัติการของอุปกรณ์หรือบริการ HTTP จริง ไม่มี routing table แบบ static/dynamic, NAT หรือ STP การกำหนด gateway และ TCP/UDP services ที่เว้นว่างใช้สมมติฐานเพื่อรองรับงานเก่า ใช้ Live Verify สำหรับการตรวจ Network จริง

## Planning และไฟล์

Subnet Calculator เดิมและ VLSM Planning แบ่ง IPv4 ตามจำนวนเครื่องได้ เพิ่ม IPv6 Planning สำหรับ parent prefix, child prefix และจำนวน subnet พร้อมขอบเขตและจำนวน address ที่คำนวณด้วย BigInt IPv6 รองรับการวางแผน/คำนวณ; packet simulation ใช้ IPv4 กดคำนวณ Subnet จาก Node ที่มีเฉพาะ IPv6 เพื่อเปิด IPv6 Calculator ได้

Backup ส่งออก Workspace JSON เก็บ topology, model, port, ACL, services, งานที่มอบหมายและแผน IPv4/IPv6 ใช้ Import เพื่อเปิดแก้ไขต่อ ไฟล์เก่ายังคงนำเข้าได้และได้รับการจับคู่พอร์ตตามลำดับอย่างคงที่

## ทำงานร่วมกัน

สมาชิกเห็นตำแหน่งขณะลากอุปกรณ์ก่อนบันทึก งานและค่าคอนฟิกใช้ revision เดิมเพื่อป้องกันเขียนทับข้อมูลที่ใหม่กว่า Local server ส่ง preview ผ่าน Socket.IO; Cloud ใช้ polling ประมาณ 800ms สถานะผู้แก้ไขที่หยุดส่งจะหมดอายุโดยอัตโนมัติ

Assign job ใน Device Properties ระบุชื่อเรื่อง สมาชิกและ To do/In progress/Done ได้ งานแสดงบน Canvas และในแผงสมาชิกของห้อง

Voice เป็น WebRTC ภายในห้อง สูงสุด 8 คน มีเปิด/ปิดไมค์และออกจากห้อง Signaling ส่งเฉพาะผู้รับที่เข้าร่วม Voice ใช้ HTTPS หรือ localhost และอนุญาตไมโครโฟน เครือข่ายที่ STUN เชื่อมต่อไม่ได้ต้องกำหนด TURN ด้วย `VITE_RTC_ICE_SERVERS` (JSON array ของ RTCIceServer) การทดสอบอัตโนมัติครอบคลุม signaling, offer/answer, ICE, mute และ cleanup; การรับส่งเสียงจริงและ TURN ต้องทดสอบกับเบราว์เซอร์และเครือข่ายที่จะใช้

## ตรวจสอบ

`npm run check` ตรวจ build, local API, Cloud API และ Vue components

`node scripts/preview-lab.js` เปิดห้อง QA ที่ `http://127.0.0.1:3108/__fixture` ใช้ฐานข้อมูลชั่วคราวและ test-only session fixture โดยไม่แก้ฐานข้อมูลใช้งานจริง ต้อง build ก่อน และไม่ใช้เป็น production server
