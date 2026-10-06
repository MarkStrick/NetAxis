# NETAXIS — Network Planning & Verification

พื้นที่ทำงานสำหรับ Plan → Calculate → Validate → Scale → Verify เครือข่าย พร้อม Topology ที่แก้ร่วมกันแบบ realtime ใช้ Vue และ Express; Vercel ใช้ Postgres + polling ส่วน local dev ใช้ SQLite + Socket.IO

## ฟีเจอร์

- สร้าง/เข้าร่วม/เปิดห้องโดยไม่ต้อง login ใช้ room code และสิทธิ์ owner/editor/viewer
- ห้องมีอายุ 24 ชั่วโมงจากเวลาสร้าง พร้อม countdown; หมดอายุแล้วปิด REST/Socket/Probe และซ่อนจากรายการ
- จัดการอุปกรณ์และสาย, properties IPv4/CIDR, IPv6, MAC, VLAN, status, vendor และ notes
- เชื่อมสายด้วยคลิก, ลาก port หรือ Enter/Space; pan/zoom/fit canvas, ค้นหา/กรอง และ Undo/Redo
- ซิงก์ topology/presence หลายแท็บและผู้ใช้ พร้อมตรวจ revision ป้องกันการเขียนทับข้อมูลที่ใหม่กว่า
- IP Planning: parent network, site/department/VLAN, hosts, growth %, VLSM, gateway/reserved และ utilization
- Validate overlap, IP ซ้ำ/นอก subnet, network/broadcast, capacity และ reserved conflict
- Scale/What-if เปรียบเทียบแผนก่อน/หลังและระบุ subnet ที่ต้อง resize/reallocate
- IPAM และ Live Verify ผ่าน Probe ของแต่ละ network segment: ping, host probe, ARP/neighbor, traceroute และ local netstat
- เปรียบเทียบ Planned vs Observed: unexpected device, missing/down, reserved conflict, IP–MAC mismatch และ capacity risk
- Realtime Templates 4 แบบ พร้อม IPAM และ 16 scenarios: Small Office, VLAN Office, Branch ↔ HQ และ Server Rack
- Packet Tracer-style Simulator: Simple/Complex PDU, ARP/ICMP/TCP/UDP model, Event List, Step/Play/Pause/Resume/Stop และ OSI/PDU details
- Backup/Restore Workspace ครบ Topology, IPAM และ scenarios เป็นห้องใหม่; นำเข้า topology JSON เดิม, CSV ภาษาไทยและ PNG
- แจ้งเตือนก่อนออกจาก IP Planning ที่ยังไม่บันทึก และนำ IP จาก topology เข้าแผนปัจจุบันได้
- Persistent sessions, owner recovery key, HttpOnly cookies, origin checks, request limits และ online database backup
- Glassmorphism UI พร้อม responsive layouts

Realtime Simulator เป็นแบบจำลองสำหรับออกแบบและเรียนรู้ ไม่ส่ง packets ไป hardware การตรวจเครือข่ายจริงต้องรัน **Probe** ใน network segment นั้น สถานะที่กำหนดเองบน topology ไม่ใช่ผล ping อัตโนมัติ

## เริ่มพัฒนา

ใช้ Node.js 24 หรือ Node >=22.12:

```sh
npm ci
npm run dev
```

เปิด `http://localhost:5173` หน้าเว็บ proxy `/api` และ `/socket.io` ไป backend port 3000 คำสั่ง dev โหลด `.env` ถ้ามีและ restart backend เมื่อแก้ไฟล์ ไม่ต้องใช้ global login หากใช้ `.env` ของ production อยู่ ให้ปรับ `PUBLIC_ORIGIN` ให้เหมาะกับ environment ก่อนรัน dev

ฐานข้อมูลเริ่มต้นอยู่ใน `data/netaxis.sqlite` เปลี่ยนได้ด้วย `DATA_DIR` ไม่ commit ฐานข้อมูล, `.env`, backups หรือ credentials ลง Git

## ตรวจสอบ

```sh
npm run check
npm audit
```

`check` ทำ production build แล้วรัน server/HTTP/Socket tests และ Vue component tests ใช้ฐานข้อมูลชั่วคราวแยกจากข้อมูลจริง รวม startup/restart, expiry, role enforcement, room recovery, backup/restore, IPAM/Probe, simulator, templates, Undo/Redo และ Vercel routing, Postgres integration และ runtime packaging

หากรันเฉพาะ tests ให้ `npm run build` ก่อน เพราะ production smoke tests ต้องใช้ `dist`:

```sh
npm run test:server
npm run test:client
```

## ติดตั้ง production

ติดตั้งหน้าเว็บและ API บน **Vercel โปรเจกต์เดียว + Neon Postgres ผ่าน Marketplace** ไม่ต้องเช่า server แยก เริ่มจาก [LAUNCH.md](LAUNCH.md) และดูรายละเอียดใน [PRODUCTION.md](PRODUCTION.md)

ตั้ง DATABASE_URL ที่ integration ให้มาแล้ว Redeploy; ไม่ใช้ NETAXIS_BACKEND_URL ห้องซิงก์ผ่าน HTTP polling ประมาณทุก 2 วินาที ส่วน Simulator ทำงานทันทีใน browser

สำหรับ self-host ทั้ง frontend/backend บนเครื่องเดียว เตรียม `.env` จาก `.env.example` ให้มี `PUBLIC_ORIGIN` แบบ HTTPS แล้วรัน:

```sh
npm ci
npm run check
npm start
```

ตั้ง TLS reverse proxy หน้า port 3000 หรือใช้ `compose.yaml` ที่มี Caddy และ named volumes ให้แล้ว ห้ามเปิด Vite dev server แทน production

## คู่มือใช้งาน

- [PLANNING.md](PLANNING.md): Plan → Calculate → Validate → Scale → Live Verify และติดตั้ง Probe
- [SIMULATOR.md](SIMULATOR.md): Simulator controls, protocol model และขอบเขตการจำลอง
- [TEMPLATES.md](TEMPLATES.md): เลือก Template, รัน scenarios และนำ design ไปติดตั้งจริง
- [LAUNCH.md](LAUNCH.md): ไฟล์และลำดับการติดตั้ง Vercel + backend
- [PRODUCTION.md](PRODUCTION.md): การตั้งค่า, ตรวจหลังติดตั้ง, backup และ recovery

## การเก็บงานและขอบเขต

ห้องมีอายุ **24 ชั่วโมง** การเข้าซ้ำ แก้ไข หรือ restart ไม่ต่ออายุ Session อายุ 30 วันและ recovery key ใช้ได้เฉพาะห้องที่ยังไม่หมดอายุ ห้องเก่าที่อัปเกรด schema ครั้งแรกได้รับเวลาอีก 24 ชั่วโมงครั้งเดียว

ก่อนหมดอายุ บันทึกแผน IPAM แล้วกด **Backup** เพื่อดาวน์โหลด `netaxis-workspace.json` จากนั้นหน้าแรก → **กู้คืน Workspace จากไฟล์** เพื่อทำงานต่อในห้องใหม่พร้อม Topology, IPAM และ scenarios ไม่คัดลอก credentials/ผู้เข้าร่วม/Probe state ต้อง enroll Probe ใหม่ การ restore ฐานข้อมูลทั้งระบบของผู้ดูแลยังคง expiry เดิม

ข้อมูลห้องหมดอายุเก็บใน SQLite สำหรับผู้ดูแล แต่ Web/API/Probe เข้าถึงไม่ได้ ไม่มี automatic hard delete ควรมีนโยบาย retention และสำรองข้อมูลของ server

รองรับ 500 devices / 1000 links ต่อห้อง JSON request สูงสุด 1 MB ยกเว้น Restore Workspace 5 MB ประวัติ Undo/Redo อยู่ใน browser และล้างเมื่อผู้ร่วมงานแก้ topology เพื่อไม่ให้ย้อนทับงานผู้อื่น

โหมด local/self-host ที่ใช้ SQLite รองรับหนึ่ง process/replica ส่วน Vercel ใช้ Postgres ร่วมกันข้าม Function instances ระบบไม่มีบัญชีรายบุคคล/SSO หรือ audit log สำหรับองค์กร Simulator ไม่มี IOS CLI, per-interface routing table หรือ policy/packet stack จริง ใช้ Probe และเครื่องมืออุปกรณ์เพื่อตรวจ hardware

## โครงสร้าง

- `src/client/App.vue`: ห้อง, topology canvas, properties และ backup/restore
- `src/client/PlanningWorkspace.vue`: IP Planning/IPAM และ Live Verify
- `src/client/SimulatorPanel.vue`, `src/client/lib/simulator.js`: Simulator UI และ protocol model
- `src/client/glass.css`, `src/client/styles.css`: Glass UI และ responsive layouts
- `src/shared/`: Templates และ room lifetime ที่ client/server ใช้ร่วมกัน
- `src/server/index.js`: HTTP/Socket API และ authoritative permissions
- `src/server/db.js`: SQLite schema, additive migrations และ transactions
- `src/server/workspaces.js`: validated workspace backup/restore
- `src/server/planning-api.js`, `src/server/lib/planning.js`: IPAM/design และ Probe API
- `src/server/lib/security.js`, `validation.js`, `subnet.js`: Security, validation และ subnet calculation
- `scripts/`: Vercel build, deployment verification, database backup, owner recovery และ Probe agent
- `tests/`: API, realtime, security, persistence, planning, simulator และ component regressions
#   N e t A x i s  
 #   N e t A x i s  
 
