# ทางเลือก: ติดตั้งบน Node server ของตนเอง

คู่มือนี้สำหรับ SQLite/Socket.IO แบบเดิม ไม่จำเป็นสำหรับ Vercel + Neon ดู LAUNCH.md สำหรับการติดตั้งหลัก

## Self-hosted Node server

ใช้ Node.js 24 LTS หรือ Node >=22.12 เตรียม `.env` จาก `.env.example`:

```dotenv
PUBLIC_ORIGIN=https://netaxis.example.com
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=loopback
DATA_DIR=./data
BACKUP_DIR=./backups
```

`PUBLIC_ORIGIN` ต้องเป็น HTTPS origin ที่ browser ใช้จริง และไม่มี `/` ท้าย URL ระบุ `TRUST_PROXY` เฉพาะ IP/subnet ของ reverse proxy ที่เชื่อถือได้ อย่าใช้ `true` โดยเปิด backend ให้ Internet เข้าถึงโดยตรง

```sh
npm ci
npm run check
npm start
```

`npm start` เปิด production mode, โหลด `.env`, เสิร์ฟหน้าเว็บที่ build แล้วจาก port 3000 และปฏิเสธ startup เมื่อขาด HTTPS origin หรือยังไม่มี build ตั้ง reverse proxy ที่มี TLS มายัง `127.0.0.1:3000` และใช้ process manager/service ที่ restart อัตโนมัติ เปิดสู่ Internet เฉพาะ port 80/443 ไม่ใช่ Vite dev server

ตัวอย่าง Caddy สำหรับ Node server ที่ติดตั้งบนเครื่องเดียวกัน:

```caddyfile
netaxis.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

DNS ของ domain ต้องชี้มายัง server และเข้าถึง port 80/443 ได้ Caddy จัดการ TLS และ WebSocket proxy ตาม [เอกสาร Automatic HTTPS](https://caddyserver.com/docs/automatic-https) และ [reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

## Docker Compose ทางเลือกสำหรับ self-hosting

สร้าง `.env` โดยกำหนด `DOMAIN` ของ **backend** และ `PUBLIC_ORIGIN` ที่ผู้ใช้เปิดจริง ห้าม commit `.env`:

```dotenv
DOMAIN=api.example.com
PUBLIC_ORIGIN=https://ชื่อโปรเจกต์.vercel.app
```

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

Compose ใช้ Node app หนึ่ง instance กับ Caddy ด้านหน้า, named volumes สำหรับ SQLite/backup/certificates และไม่ publish backend port 3000 ตัว image build จะรัน build และชุดทดสอบก่อนตัด dev dependencies รัน app ด้วยผู้ใช้ `node`

หาก self-host ทั้งหน้าเว็บและ API ให้ตั้ง `DOMAIN=netaxis.example.com` และ `PUBLIC_ORIGIN=https://netaxis.example.com` หากไม่กำหนด `PUBLIC_ORIGIN` Compose ใช้ `https://${DOMAIN}` เป็นค่าเริ่มต้น การเปลี่ยน env ให้รัน `docker compose up -d` ใหม่เพื่อสร้าง container ด้วยค่าใหม่

ตรวจ Compose configuration และ smoke test โดยคัดลอกไฟล์ตาม runtime COPY ของ Dockerfile ลงโฟลเดอร์แยกแล้วรัน production server รวมการโหลด assets, proxied REST/session และ direct WebSocket แล้ว เครื่องทดสอบมี Docker CLI แต่ daemon ไม่ทำงาน จึงยังไม่ได้ build/run image หรือทดสอบ TLS ผ่าน Caddy จริง

## Backup และกู้คืน

**Workspace สำหรับผู้ใช้:** กด Backup ใน toolbar เพื่อรับ `netaxis-workspace.json` ซึ่งมี Topology, แผน IPAM ที่บันทึกแล้ว และ Template scenarios จากนั้นหน้าแรก → กู้คืน Workspace จากไฟล์ → ใส่ชื่อที่แสดง → กู้คืนเป็นห้องใหม่ การกู้คืนสร้าง device/link IDs และ owner recovery key ใหม่ ห้องเดิมไม่เปลี่ยนแปลง ไม่รวม credentials, ผู้เข้าร่วม, Probe enrollment/jobs/observations หรือประวัติ Undo/Redo ต้อง enroll Probe ใหม่ในห้องใหม่ ไฟล์เก็บ IP/MAC/notes ของงาน จึงควรเก็บตามสิทธิ์ของข้อมูลนั้น

**ฐานข้อมูลสำหรับผู้ดูแล:** รวมข้อมูลทุกห้อง, สิทธิ์ และ Probe state; expiry เดิมคงอยู่เมื่อกู้ฐานข้อมูล:

```sh
npm run backup
# หรือเมื่อใช้ Docker
docker compose exec app npm run backup
```

Backup ใช้ SQLite online backup API เพื่อให้ snapshot สอดคล้องกับ WAL อย่าคัดลอกเฉพาะไฟล์ SQLite ขณะ server เขียนอยู่ เก็บสำเนา backup นอกเครื่อง production ด้วย ตั้ง scheduler ของ server ตามรอบเวลาที่องค์กรต้องการ

กู้คืนโดยหยุด app, เก็บสำเนาฐานข้อมูลและไฟล์ WAL/SHM เดิม, วาง backup เป็น `DATA_DIR/netaxis.sqlite` และเริ่ม app ด้วย directory ที่ไม่มี WAL/SHM เก่าค้างอยู่ การ rollback app ต้องพิจารณาฐานข้อมูลร่วมด้วย migration ปัจจุบันเป็นการเพิ่มตาราง/คอลัมน์

ข้อมูล session ใน backup เป็น hash ของ token ไม่ใช่ token ดิบ แต่ข้อมูล topology ยังเป็นข้อมูลจริง ควบคุมสิทธิ์อ่านไฟล์และใช้ encrypted storage/backups ตามนโยบายองค์กร

## กู้สิทธิ์เจ้าของห้อง

เจ้าของดาวน์โหลด recovery key เมื่อสร้างห้อง หรือออกรหัสใหม่ในตั้งค่าห้อง ใช้ Room code + recovery key ในตัวเลือก “กู้สิทธิ์เจ้าของห้อง” บนหน้าเข้าร่วม รหัสกู้สิทธิ์เก็บเป็น hash ในฐานข้อมูล การออกรหัสใหม่ยกเลิกรหัสเดิม

สำหรับห้องเก่าที่ไม่มี recovery key หรือ session เจ้าของสูญหาย ผู้ดูแลที่มีสิทธิ์เข้าถึง server สามารถออก recovery key:

```sh
npm run recover-owner -- <room-id>
# Docker
docker compose exec app npm run recover-owner -- <room-id>
```

คำสั่งแสดง recovery key หนึ่งครั้งใน terminal อย่าส่ง key ลง application logs หรือแบ่งปันพร้อม invitation code กับผู้ที่ไม่ควรเป็นเจ้าของ

## การตรวจหลังติดตั้ง

IP Planning/IPAM และคิวงาน Probe บันทึกในฐานข้อมูลเดียวกับห้อง ดู [PLANNING.md](PLANNING.md) สำหรับติดตั้ง Probe แต่ละ segment และทดสอบผล Planned vs Observed ผ่าน HTTPS

```sh
npm run verify:deployment -- https://netaxis.example.com
```

คำสั่งนี้อ่านหน้าเว็บ/assets/health และตรวจ origin กับ headers เท่านั้น ไม่สร้างห้องและไม่ส่ง credentials จากนั้นตรวจ flow ด้วย browser จริง:

1. `/api/health` ตอบ `ok: true` และ frontend/assets โหลดได้ผ่าน HTTPS
2. หน้าแรกและการสร้างห้องใช้งานได้ทันที ผู้ที่ไม่ได้เข้าร่วมห้องเข้าถึง topology หรือรหัสเชิญห้องอื่นไม่ได้
3. สร้างห้อง เปิดสอง browser/อุปกรณ์ด้วย room code แล้วเพิ่ม/แก้ไข/ลาก/ลบอุปกรณ์และสาย ตรวจว่า sync ตรงกัน
4. Viewer แก้ไขหรือนำเข้าไม่ได้ เจ้าของลดสิทธิ์ editor ได้ทันที
5. Backup Workspace → กลับหน้าแรก → Restore ได้ทั้ง Topology, IPAM และ scenarios; นำเข้า topology JSON แบบเดิมได้, CSV และ PNG ใช้งานได้ ตรวจ PNG ว่าสีและข้อความครบ
6. Undo/Redo คืนทั้งอุปกรณ์และสายที่ถูกลบได้ ประวัติจะถูกล้างเมื่อผู้เข้าร่วมอื่นแก้ topology
7. Restart app แล้วห้อง ข้อมูล และสิทธิ์เจ้าของยังอยู่ ทดสอบกู้สิทธิ์ใน browser ใหม่ด้วย recovery key
8. ทำ backup และทดสอบ restore บนเครื่องแยกก่อนใช้งานจริง
9. ใช้ Template → Run Scenario → Pause/Resume → Stop และปิด/เปิด Simulator แล้ว nodes/links ยังอยู่
10. IP Planning → นำเข้าจาก Topology → แก้ hosts → ออกโดยเลือกบันทึก/แก้ต่อ; What-if และ Live Verify ใช้ Probe ของ segment จริงได้

## ขอบเขตปัจจุบัน

- รองรับ 500 nodes / 1000 links ต่อห้อง และ JSON request/import ไม่เกิน 1 MB; endpoint Restore Workspace รับ JSON ไม่เกิน 5 MB
- Simulator มี ARP/ICMP/TCP/UDP educational model ตาม topology ไม่มี IOS CLI, per-interface routing table, firewall policy หรือ protocol stack จริง และไม่ได้ส่ง packet ไป hardware
- สถานะอุปกรณ์เป็นข้อมูลที่ผู้ใช้ระบุ ไม่ใช่ ping/SNMP monitoring
- SQLite backend ใช้หนึ่ง process/replica การ scale หลาย instance ต้องเปลี่ยนฐานข้อมูลและระบบ realtime
- API จำกัด 300 requests/นาทีต่อ IP ที่ backend เห็น หากอยู่หลัง Vercel/reverse proxy หลายชั้นอาจนับรวมผู้ใช้ที่มาจาก proxy IP เดียวกัน ต้องตรวจ forwarding chain และ capacity บน infrastructure จริงก่อนเปิดรับผู้ใช้จำนวนมาก ให้เชื่อถือเฉพาะ proxy ที่ควบคุมได้ ห้ามตั้ง `TRUST_PROXY=true` เพื่อแก้ปัญหานี้
- ระบบยังไม่มีบัญชีรายบุคคล, SSO, audit log หรือการจัดการสมาชิกแบบองค์กร
- การตั้งค่าความปลอดภัยของเครื่องมือ browser ปิดการเข้าถึง localhost จึงตรวจด้วย HTTP/Socket tests และ Vue component tests การเรนเดอร์หน้าจอ/PNG และ flow บน Vercel จริงยังต้องตรวจหลังติดตั้ง
