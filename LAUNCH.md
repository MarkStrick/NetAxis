# เปิด NETAXIS บน Vercel

หน้าเว็บและ API อยู่ใน Vercel โปรเจกต์เดียว **ไม่ต้องเช่า server แยก** ข้อมูลเก็บใน Neon Postgres ซึ่งเพิ่มผ่าน Vercel Marketplace ได้ ฐานข้อมูลเป็นบริการจัดการให้ ไม่ต้องติดตั้งเอง

## ทำตามนี้

1. Push โปรเจกต์ขึ้น GitHub โดยไม่ใส่ไฟล์ .env, data, node_modules หรือรหัสลับ
2. เข้า Vercel → Add New → Project → Import repository นี้ เลือกโฟลเดอร์ที่มี package.json เป็น Root Directory
3. เลือก Framework **Vite** และ Node.js **24.x** ใช้ค่าจาก vercel.json: Install = npm ci --ignore-scripts, Build = npm run build:vercel, Output = dist ถ้าเคยตั้ง Framework Other หรือ Output Directory แบบเก่า ให้แก้ตามนี้
4. ในโปรเจกต์เปิด Storage / Marketplace → เพิ่ม **Neon Postgres** → Connect กับโปรเจกต์และ environment **Production** เลือก region ใกล้ Vercel Function ตรวจว่า Environment Variables มี **DATABASE_URL** (รองรับ POSTGRES_URL ด้วย) ใช้ connection string แบบ pooled ที่ integration ให้มา
5. กด **Redeploy** หลังเชื่อมฐานข้อมูล ระบบสร้างตารางให้อัตโนมัติเมื่อเรียก API ครั้งแรก
6. เปิด URL ที่ Vercel ให้ เช่น https://ชื่อโปรเจกต์.vercel.app แล้วลองสร้างห้องจาก Template

ไม่ต้องใส่ NETAXIS_BACKEND_URL, VITE_API_BASE, VITE_SOCKET_ORIGIN, PORT หรือ DATA_DIR ใน Vercel ลบค่าเก่าที่เคยตั้งไว้ รวมถึง PUBLIC_ORIGIN ที่ชี้ localhost/backend เก่า ห้ามตั้ง NODE_ENV=development

URL vercel.app ใช้ได้อัตโนมัติ โดยต้องเปิดระบบ Environment Variables ของ Vercel ตามค่าเริ่มต้น ถ้าใช้ custom domain ให้เพิ่ม PUBLIC_ORIGIN เช่น https://netaxis.example.com (ไม่มี / ท้าย URL) แล้ว Redeploy ห้ามใส่ DATABASE_URL ในตัวแปรที่ขึ้นต้น VITE_ เพราะจะเปิดเผยรหัสผ่านในหน้าเว็บ

## เช็กว่าใช้งานได้

เปิด /api/health ต่อท้าย URL ต้องเห็น ok: true, storage: postgres, deployment: vercel จากนั้นเปิดห้องเดียวกันสอง browser เพิ่มอุปกรณ์ในหน้าหนึ่ง อีกหน้าควรตามมาภายในประมาณ 2 วินาที บวกเวลาเครือข่าย กด refresh แล้วข้อมูลต้องยังอยู่

ตรวจอัตโนมัติจากโฟลเดอร์โปรเจกต์:

```sh
npm run verify:deployment -- https://ชื่อโปรเจกต์.vercel.app
```

ถ้าเห็น DATABASE_NOT_CONFIGURED ให้ตรวจว่า Neon เชื่อม Production และมี DATABASE_URL แล้ว Redeploy ถ้า API ตอบ HTML ให้ตรวจ Root Directory และใช้ vercel.json ชุดนี้ ถ้า Origin is not allowed ให้แก้ PUBLIC_ORIGIN ให้ตรง URL ที่เปิด หรือลบค่าเก่าเมื่อใช้โดเมน Vercel

## สิ่งที่ควรรู้

- ห้องอยู่ได้ 24 ชั่วโมง ข้อมูลห้อง, IPAM, Template และคิว Probe อยู่ใน Postgres ไม่หายเมื่อ Function เปลี่ยน instance หรือ deploy ใหม่ตราบใดที่ใช้ฐานข้อมูลเดิม
- การแก้ห้องร่วมกันซิงก์ประมาณทุก 2 วินาทีขณะเปิดแท็บ ส่วน Simulator ทำงานทันทีใน browser
- Live Verify ต้องเปิด Probe บนคอมพิวเตอร์ใน LAN ที่จะตรวจ ใช้คอมพิวเตอร์ที่มีอยู่ได้ ไม่ต้องเช่า server เพิ่ม และไม่ต้องเปิด inbound port ให้ Probe
- Neon และ Vercel มี quota/ค่าใช้จ่ายตามแผนที่เลือก โปรเจกต์ไม่ได้สมัครหรือเปิดบริการให้โดยอัตโนมัติ
- ห้องเดิมในเครื่อง: กด Backup ก่อนหมดอายุ แล้ว Restore บนเว็บใหม่ จะได้ห้องใหม่อายุ 24 ชั่วโมง ต้อง enroll Probe ใหม่
- Preview ควรเชื่อมฐานข้อมูลทดสอบหรือ Neon branch แยกจาก Production เพราะ API ของ Preview เขียนข้อมูลได้จริง

ดูรายละเอียดทางเทคนิคและการตรวจหลัง deploy ใน [PRODUCTION.md](PRODUCTION.md)

อ้างอิง: [Vite และ API บน Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Neon ใน Marketplace](https://vercel.com/marketplace/neon), [Postgres บน Vercel](https://vercel.com/docs/postgres)
