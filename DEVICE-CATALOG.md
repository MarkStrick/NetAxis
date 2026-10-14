# รายการรุ่นอุปกรณ์ NetAxis

เพิ่ม 25 โปรไฟล์ฮาร์ดแวร์จริง และ 1 Internet uplink เชิงตรรกะ ครอบคลุมทั้ง 9 ประเภทเดิม ไม่ใช่รายการอุปกรณ์ทั้งหมดในตลาดหรืออันดับยอดขาย ตรวจจากเอกสารผู้ผลิตเมื่อ 14 ตุลาคม 2026

คลิกการ์ดประเภท → เลือกรุ่น / ดูสเปก → ตั้งชื่อ → เพิ่มลงผัง ลากจากการ์ดมาวางก็ต้องเลือกรุ่นก่อนเช่นกัน รายการอ่านจาก `GET /api/device-models` ซึ่งอ่านจากฐานข้อมูล

## ฐานข้อมูล

SQLite ใช้ตาราง `device_models` ส่วน Postgres ใช้ `netaxis_device_models` ระบบสร้างตารางและ upsert รุ่นจาก catalog เมื่อเปิดแอปเวอร์ชันนี้ครั้งแรก ไม่มีการแก้ห้อง ผังเดิม หรือสมาชิก ไม่ต้องเพิ่ม server หรือบริการใหม่ เมื่อ deploy เวอร์ชันนี้ cloud initialization จะเติมข้อมูลด้วยวิธีเดียวกัน ยังไม่ได้ deploy จากงานนี้

Catalog กลางอยู่ใน `src/shared/device-catalog.js` และรวมกับ Lab presets เดิมใน `src/shared/devices.js` เพื่อให้การเลือกจาก DB, validation, พอร์ต, CLI และ Save / Load รู้จัก model ID เดียวกัน เพิ่มรุ่นใหม่ต้องเพิ่มโปรไฟล์กลางและปล่อยเวอร์ชันเดียวกันทั้งหน้าเว็บและ API; ไม่มีหน้าแก้ catalog โดยผู้ใช้

## รุ่นและแหล่งข้อมูล

| ประเภท | ยี่ห้อ / รุ่น | พอร์ต data จริง | เอกสาร |
|---|---|---:|---|
| Router | Cisco ISR 4331/K9 | 3 | [ผู้ผลิต](https://www.cisco.com/c/en/us/products/collateral/routers/4000-series-integrated-services-routers-isr/data_sheet-c78-732542.html) |
| Router | Cisco ISR 4321/K9 | 2 | [ผู้ผลิต](https://www.cisco.com/c/en/us/products/collateral/routers/4000-series-integrated-services-routers-isr/data_sheet-c78-732542.html) |
| Router | MikroTik hEX S · RB760iGS | 6 | [ผู้ผลิต](https://mikrotik.com/product/hex_s) |
| Router | MikroTik L009UiGS-RM | 9 | [ผู้ผลิต](https://mikrotik.com/product/l009uigs_rm) |
| Switch | Cisco Catalyst C9200L-24P-4G | 28 | [ผู้ผลิต](https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html) |
| Switch | Cisco Catalyst C9200L-48P-4G | 52 | [ผู้ผลิต](https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html) |
| Switch | Cisco Catalyst C9300L-24P-4X | 28 | [ผู้ผลิต](https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html) |
| Switch | Cisco Catalyst C9300L-48P-4X | 52 | [ผู้ผลิต](https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html) |
| Switch | TP-Link TL-SG105 | 5 | [ผู้ผลิต](https://www.tp-link.com/sg/home-networking/soho-switch/tl-sg105/) |
| Switch | TP-Link TL-SG108 | 8 | [ผู้ผลิต](https://www.tp-link.com/sg/home-networking/soho-switch/tl-sg108/) |
| Switch | Ubiquiti UniFi USW-Lite-8-PoE | 8 | [ผู้ผลิต](https://techspecs.ui.com/unifi/wifi/usw-lite-8-poe) |
| Firewall | Fortinet FortiGate 40F | 5 | [ผู้ผลิต](https://www.fortinet.com/content/dam/fortinet/assets/data-sheets/fortigate-fortiwifi-40f-series.pdf) |
| Firewall | Fortinet FortiGate 60F | 10 | [ผู้ผลิต](https://www.fortinet.com/content/dam/fortinet/assets/data-sheets/FortiGate_FortiWiFi_60E_Series.pdf) |
| Access Point | Ubiquiti UniFi U6+ | 1 | [ผู้ผลิต](https://techspecs.ui.com/unifi/wifi/u6-plus) |
| Access Point | Ubiquiti UniFi U7 Lite | 1 | [ผู้ผลิต](https://techspecs.ui.com/unifi/wifi/u7-lite) |
| Access Point | Ubiquiti UniFi U7 Pro | 1 | [ผู้ผลิต](https://techspecs.ui.com/unifi/wifi/u7-pro) |
| PC / Laptop | Dell OptiPlex Tower 7010 (2023) | 1 | [ผู้ผลิต](https://www.dell.com/support/kbdoc/en-vn/000211963/dell-optiplex-tower-7010-system-guide) |
| Server | Dell PowerEdge R350 | 2 | [ผู้ผลิต](https://www.delltechnologies.com/asset/en-us/solutions/oem-solutions/technical-support/dell-emc-oem-poweredge-r350-spec-sheet.pdf) |
| Printer | Brother HL-L2375DW | 1 | [ผู้ผลิต](https://support.brother.com/g/b/spec.aspx?c=au&lang=en&prod=hll2375dw_eu_as) |
| Printer | HP LaserJet Pro 4003dn | 1 | [ผู้ผลิต](https://h20195.www2.hp.com/v2/GetDocument.aspx?docname=c08818382) |
| NAS / Phone / Camera | Synology DiskStation DS224+ · NAS | 2 | [ผู้ผลิต](https://www.synology.com/en-ca/products/DS224%2B) |
| PC / Laptop | Lenovo ThinkPad T14 Gen 5 (Intel) | 1 | [ผู้ผลิต](https://psref.lenovo.com/syspool/Sys/PDF/ThinkPad/ThinkPad_T14_Gen_5_Intel/ThinkPad_T14_Gen_5_Intel_Spec.pdf) |
| NAS / Phone / Camera | Synology DiskStation DS923+ · NAS | 2 | [ผู้ผลิต](https://global.download.synology.com/download/Document/Hardware/DataSheet/DiskStation/23-year/DS923%2B/enu/Synology_DS923%2B_Data_Sheet_enu.pdf) |
| NAS / Phone / Camera | Cisco IP Phone 8841 | 2 | [ผู้ผลิต](https://www.cisco.com/c/en/us/products/collateral/collaboration-endpoints/unified-ip-phone-8800-series/datasheet-c78-731638.html) |
| NAS / Phone / Camera | TP-Link Tapo C320WS V1 · IP Camera | 1 | [ผู้ผลิต](https://www.tapo.com/tr/product/smart-camera/tapo-c320ws/) |
| Internet (logical) | Logical Internet / ISP uplink | 0 | Logical profile |

## ขอบเขตการจำลอง

- พอร์ต data ไม่รวม console, USB, ช่อง management และโมดูลเสริม NIC / uplink ที่ยังไม่ได้เลือก
- สวิตช์ Catalyst แบบ fixed uplink มี 24/48 access + 4 uplink = 28/52 จุดเชื่อม L3 ขึ้นกับ license ของฮาร์ดแวร์จริง ใน Lab ต้องเปิด IP routing และตั้ง interface IPv4; ยังไม่มี SVI
- AP มี Ethernet จริง 1 ช่อง และ Radio0 เชิงตรรกะ 1 จุดใน Lab ไม่จำลอง SSID, RF, roaming หรือจำนวน clients
- ใช้ชื่อพอร์ตแต่ละรุ่นทั้ง Port Connection และ Scenario; Cisco router/switch เปิด CLI จำลองได้ รุ่นอื่นใช้การจำลอง IPv4 กลาง ไม่ใช่ RouterOS / FortiOS / UniFi controller
- ความเร็ว, Wi-Fi generation และ PoE เป็นข้อมูลสเปก ไม่มีการจำลอง throughput, ไฟฟ้า หรือ firmware
- NAS / IP Camera เป็นปลายทาง ไม่ส่งต่อเหมือน switch; IP Phone มี passthrough 2 พอร์ต แต่ไม่จำลอง SIP / Voice VLAN / โทรศัพท์
- Unmanaged switch ไม่รับการตั้ง VLAN / Trunk; Lab preset เดิมยังเลือกได้โดยเปิดแสดงรุ่น Lab
- ยังเก็บ legacy model IDs และการจัดพอร์ตเดิมเพื่อให้ไฟล์งานและแม่แบบเดิมโหลดต่อได้
