# NetAxis production deployment

## สถานะและสถาปัตยกรรม

เวอร์ชันนี้มี Vue/Vite frontend, Express/Socket.IO backend และ SQLite แบบ WAL เหมาะกับ Node server หนึ่ง instance ที่มี persistent disk ฐานข้อมูลและสิทธิ์ห้องอยู่ใน `DATA_DIR` การบันทึก topology และ revision อยู่ใน transaction เดียวกัน

การเข้าใช้ระบบใช้ **รหัสเชิญห้องและสิทธิ์ผู้เข้าร่วม** ไม่ใช่บัญชีผู้ใช้รายบุคคล ผู้เข้าร่วมมีบทบาท owner/editor/viewer ที่ server ตรวจทุกครั้ง Session ห้อง มีอายุ 30 วัน เจ้าของควรเก็บ owner recovery key ที่แสดงเมื่อสร้างห้อง เพื่อกู้สิทธิ์เมื่อเปลี่ยน browser หรือ session หมดอายุ

## Vercel

Vercel รองรับ WebSocket/Socket.IO ใน public beta ผ่าน Fluid Compute แล้ว ต้องตั้ง client เป็น WebSocket transport และจัดการ reconnect เมื่อ function หมดอายุ ข้อมูลถาวร, ห้อง, presence และการส่งเหตุการณ์ข้าม instance ต้องอยู่ใน external storage

**อย่านำ SQLite ในโปรเจกต์นี้ไปใช้เป็นฐานข้อมูลเขียนบน Vercel Functions หรือย้ายไฟล์ไป `/tmp` เพื่อเก็บข้อมูล production** การปรับให้รันทั้งหมดบน Vercel ต้องมี Postgres สำหรับข้อมูลและสิทธิ์ และ Redis หรือบริการ realtime สำหรับ pub/sub กับ presence ที่ใช้ร่วมกัน การเชื่อมต่อและ provisioning ของบริการเหล่านั้นต้องทำก่อน deploy จริง

อ้างอิง: [Vercel WebSockets](https://vercel.com/docs/functions/websockets), [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)

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

สร้าง `.env` โดยกำหนด `DOMAIN` จริง ห้าม commit `.env`:

```dotenv
DOMAIN=netaxis.example.com
```

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

Compose ใช้ Node app หนึ่ง instance กับ Caddy ด้านหน้า, named volumes สำหรับ SQLite/backup/certificates และไม่ publish backend port 3000 ตัว image build จะรัน build และชุดทดสอบก่อนตัด dev dependencies รัน app ด้วยผู้ใช้ `node`

เครื่องที่ใช้ตรวจโปรเจกต์นี้มี Docker CLI แต่ Docker daemon ไม่ได้ทำงาน จึงตรวจ Compose configuration ได้ แต่ยังไม่ได้ build/run image หรือทดสอบ TLS ผ่าน Caddy จริง

## Backup และกู้คืน

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

IP Planning/IPAM และคิวงาน Probe บันทึกในฐานข้อมูลเดียวกับห้อง ดู [PLANNING.md](PLANNING.md) สำหรับติดตั้ง Probe แต่ละ segment และทดสอบผล Planned vs Observed ผ่าน HTTPS การนำขึ้น Vercel ยังต้องเลือก backend/storage architecture ตามข้อจำกัดด้านบน

1. `/api/health` ตอบ `ok: true` และ frontend/assets โหลดได้ผ่าน HTTPS
2. หน้าแรกและการสร้างห้องใช้งานได้ทันที ผู้ที่ไม่ได้เข้าร่วมห้องเข้าถึง topology หรือรหัสเชิญห้องอื่นไม่ได้
3. สร้างห้อง เปิดสอง browser/อุปกรณ์ด้วย room code แล้วเพิ่ม/แก้ไข/ลาก/ลบอุปกรณ์และสาย ตรวจว่า sync ตรงกัน
4. Viewer แก้ไขหรือนำเข้าไม่ได้ เจ้าของลดสิทธิ์ editor ได้ทันที
5. JSON export/import, CSV และ PNG ใช้งานได้ ตรวจ PNG ว่าสีและข้อความครบ
6. Undo/Redo คืนทั้งอุปกรณ์และสายที่ถูกลบได้ ประวัติจะถูกล้างเมื่อผู้เข้าร่วมอื่นแก้ topology
7. Restart app แล้วห้อง ข้อมูล และสิทธิ์เจ้าของยังอยู่ ทดสอบกู้สิทธิ์ใน browser ใหม่ด้วย recovery key
8. ทำ backup และทดสอบ restore บนเครื่องแยกก่อนใช้งานจริง

## ขอบเขตปัจจุบัน

- รองรับ 500 nodes / 1000 links ต่อห้อง และ JSON request/import ไม่เกิน 1 MB
- Simulation เป็นภาพจำลองการเดินทางตามเส้นเชื่อม ไม่จำลอง routing table, firewall policy, ARP/TCP stack และไม่ได้ส่ง packet จริง
- สถานะอุปกรณ์เป็นข้อมูลที่ผู้ใช้ระบุ ไม่ใช่ ping/SNMP monitoring
- SQLite backend ใช้หนึ่ง process/replica การ scale หลาย instance ต้องเปลี่ยนฐานข้อมูลและระบบ realtime
- ระบบยังไม่มีบัญชีรายบุคคล, SSO, audit log หรือการจัดการสมาชิกแบบองค์กร
- Browser automation ถูกปฏิเสธสิทธิ์ จึงตรวจด้วย HTTP/Socket tests และ Vue component tests การเรนเดอร์หน้าจอ/PNG จริงยังต้องตรวจบน browser ที่ deploy
