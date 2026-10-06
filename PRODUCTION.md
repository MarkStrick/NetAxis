# NETAXIS — Vercel + Neon Postgres

เริ่มติดตั้งตาม [LAUNCH.md](LAUNCH.md) หน้าเว็บและ API deploy จาก repository เดียวกัน ไม่ต้องมี Node server แยก ฐานข้อมูลเป็น Neon ที่เชื่อมผ่าน Vercel Marketplace

## สถาปัตยกรรม

Browser → Vercel (Vite static + /api Function) → Neon Postgres

Probe ใน LAN → HTTPS /api บน Vercel → คิวงานและผลตรวจใน Postgres

api/index.js เป็น entry ของ Function ไม่มี app.listen, SQLite หรือ background worker การสร้างห้อง, join, roles/recovery, topology, planning, backup/restore และ Probe API ใช้ฐานข้อมูลร่วมกัน ไม่มี room state อยู่เฉพาะใน memory ของ Function

ห้องเป็น JSONB document ที่จำกัดขนาด 8 MiB พร้อม index สำหรับ room code, สมาชิก และ Probe ID การแก้ห้องใช้ transaction กับ SELECT FOR UPDATE และตรวจ revision เพื่อป้องกันเขียนทับกันข้าม instance ตาราง presence เก็บ heartbeat แยกตาม participant/tab การสร้างตารางใช้ advisory lock ให้ cold start พร้อมกันได้

## Environment และ build

- DATABASE_URL: pooled Neon Postgres connection string ที่มี SSL เก็บเฉพาะ server (fallback POSTGRES_URL)
- PUBLIC_ORIGIN: optional สำหรับ custom domain แบบ HTTPS origin ไม่มี / ท้าย URL
- VERCEL_URL / VERCEL_PROJECT_PRODUCTION_URL: system variables ของ Vercel ใช้ตรวจ exact origin ของ deployment/production โดยไม่เปิด wildcard ทุกโดเมน
- ไม่ต้องตั้ง NETAXIS_BACKEND_URL, VITE_API_BASE หรือ VITE_SOCKET_ORIGIN

vercel.json ใช้ Vite + dist และ route /api ไป api/index.js ก่อน SPA fallback ตัว build:vercel ตั้ง frontend ให้ใช้ API origin เดียวและ polling เสมอ แม้มี env URL backend เก่าค้างอยู่ใน environment

Install บน Vercel ใช้ npm ci --ignore-scripts เพื่อไม่ compile native SQLite ซึ่ง cloud API ไม่ได้ใช้ Local dev ยังใช้ npm ci ตามปกติ

## การซิงก์และข้อจำกัด

- แท็บที่เปิดอยู่ poll ประมาณทุก 2 วินาทีหลังคำขอก่อนหน้าจบ แท็บเบื้องหลังทุก 10 วินาที เกิด error จะ backoff สูงสุด 30 วินาที ไม่ซ้อนคำขอ
- เว้น polling ระหว่างลากหรือบันทึก แล้วโหลด revision ใหม่หลังเสร็จ หยุดรับ response เก่าทันทีเมื่อออกจากห้อง
- คนที่ไม่ส่ง heartbeat 45 วินาทีจะหายจาก online presence; สูงสุด 8 แท็บต่อสมาชิกต่อห้อง
- Simulator เล่น/หยุดใน browser ไม่ต้องรอ polling และไม่มี packet ส่งไปอุปกรณ์จริง
- ห้องอายุ 24 ชั่วโมง ไม่ต่ออายุเมื่อ join/redeploy หมดอายุแล้ว API และ Probe ปฏิเสธ แม้ข้อมูลยังอยู่ใน DB ไม่มีงานลบข้อมูลอัตโนมัติ
- สูงสุด 100 สมาชิก / 500 devices / 1000 links ต่อห้อง API JSON ทั่วไป 1 MiB, Restore Workspace 4 MiB
- Probe สูงสุด 100 ตัวต่อห้อง, 8 pending jobs ต่อ Probe, 256 targets ต่อ job และเก็บ completed/failed jobs ล่าสุดรวม 100 งานต่อห้อง
- rate limit ใน Express เป็นราย instance ไม่ใช่ global quota ตั้ง Vercel Firewall/rate rules และ usage alerts ให้เหมาะกับการเปิดสาธารณะ จำนวน request ขึ้นกับจำนวนผู้ใช้ที่เปิดห้องและ Probe
- ยังไม่มีบัญชีรายบุคคล, SSO หรือ audit log สมาชิกเข้าด้วย room code และสิทธิ์ห้อง

## ข้อมูลและการกู้คืน

สำรองแต่ละห้องด้วยปุ่ม Backup ก่อนหมดอายุ Restore จะสร้างห้อง/IDs/recovery key ใหม่ มี Topology, แผน IPAM ที่บันทึกแล้ว และ Template scenarios ไม่มี credentials, สมาชิก, Probe/jobs หรือ Undo history ต้อง enroll Probe ใหม่

การสำรองทั้งระบบใช้ความสามารถ backup/export ของ Neon/Postgres ตามแผนบริการ ตรวจ restore บนฐานข้อมูลแยก คำสั่ง npm run backup และ recover-owner เป็นเครื่องมือ SQLite local/self-host ไม่ใช้กับ Neon อย่าเปลี่ยน DATABASE_URL ไปฐานข้อมูลว่างแล้วคาดว่าข้อมูลจะตามไปด้วย

เจ้าของใช้ recovery key ที่ดาวน์โหลดตอนสร้างห้อง หรือออกรหัสใหม่ใน settings และใช้ร่วมกับ room code บนหน้า join การออกรหัสใหม่ยกเลิกรหัสเดิม เก็บ session, recovery และ probe token เป็น hash ใน DB

ย้ายจากเครื่องเดิมโดย export workspace แล้ว restore บน Vercel ไม่มีการอัปโหลดไฟล์ SQLite หรือ credentials ขึ้น cloud อัตโนมัติ

## การตรวจสอบ

```sh
npm run check
npm run build:vercel
npm run verify:deployment -- https://ชื่อโปรเจกต์.vercel.app
```

ชุด cloud integration tests ใช้ PostgreSQL ใน PGlite และ API สอง instance เพื่อทดสอบข้อมูลร่วมกัน, transaction rollback, revision conflicts, Template/Restore, roles, presence, expiry และ Probe leases โดยไม่ใช้ production DB PGlite ใช้ connection เดียวจึงไม่ได้จำลอง concurrent Postgres connections จริงทั้งหมด ต้องตรวจบน Neon หลัง deploy เพิ่มเติม

หลัง deploy ให้ตรวจ:

1. /api/health ตอบ postgres/vercel และไม่มี database error ใน Function logs
2. สร้างห้องเปล่าและจาก Template; refresh แล้วยังมี devices/links/plan/scenarios
3. เข้าห้องเดียวกันสอง browser แก้ topology แล้วตามกัน, Viewer แก้ไม่ได้, เปลี่ยน role แล้วสิทธิ์ตามในรอบ sync
4. ทดสอบ Undo/Redo, Backup/Restore, Planning/What-if และ Simulator Run → Pause → Stop → ปิด/เปิด
5. Redeploy โดยใช้ DB เดิมแล้ว resume ห้องและกู้สิทธิ์ผ่าน recovery key ได้
6. Enroll Probe จาก LAN, ดาวน์โหลด config (URL คือเว็บ Vercel), สั่ง Host/Scan/Neighbor/Traceroute/Netstat และตรวจผล
7. ตรวจ browser/PNG export และจำนวน requests/latency กับจำนวนผู้ใช้จริง

ยังไม่ได้ deploy เข้าบัญชี Vercel หรือทดสอบฐานข้อมูล Neon จริงในรอบแก้นี้ การทดสอบในเครื่องไม่ยืนยัน configuration ของบัญชีและ routing บน deployment จริง

Local development ใช้ npm run dev กับ SQLite/Socket.IO เช่นเดิม ถ้าต้องการ self-host ดู [SELF_HOST.md](SELF_HOST.md) และรายละเอียด Probe ดู [PLANNING.md](PLANNING.md)
