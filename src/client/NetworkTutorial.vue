<script setup>
import DialogFrame from './DialogFrame.vue';
defineProps({ writable: Boolean });
defineEmits(['close']);
</script>

<template>
  <DialogFrame title="บทสอนการสร้างเครือข่าย" title-id="network-tutorial-title" class="network-tutorial" @close="$emit('close')">
    <p>เริ่มจาก Switch 1 ตัวและ PC 2 เครื่อง แล้วทำตามบทเรียนด้านล่าง เปิดอ่านซ้ำได้ทุกเมื่อจากปุ่ม “บทสอนการใช้งาน”</p>
    <p v-if="!writable" class="permission-note">คุณมีสิทธิ์ดูอย่างเดียว เลือกอุปกรณ์และทดสอบได้ หากต้องการเพิ่มอุปกรณ์หรือแก้ไขผัง ให้เจ้าของห้องเปลี่ยนสิทธิ์เป็นแก้ไขได้</p>
    <details open>
      <summary>1. เพิ่มและจัดวางอุปกรณ์</summary>
      <p>คลิก Switch ในแถบ “เพิ่มอุปกรณ์” เลือกรุ่นแล้วเพิ่มลงผัง จากนั้นเพิ่ม PC อีก 2 เครื่อง บนมือถือให้เปิด “เพิ่ม / หาอุปกรณ์” ก่อน</p>
      <p>ใช้ “เลือก / ย้าย” แล้วลากอุปกรณ์เพื่อจัดตำแหน่ง ลากพื้นหลังเพื่อเลื่อนผัง และใช้ปุ่ม − / + เพื่อซูม</p>
    </details>
    <details>
      <summary>2. ต่อสายระหว่างอุปกรณ์</summary>
      <p>กด “ต่อสาย” เลือก PC เครื่องแรก แล้วเลือก Switch ในหน้าต่าง “เชื่อมต่อ Port → Port” เลือกพอร์ตว่างของทั้งสองฝั่ง เลือก Ethernet แล้วกด “ต่อสาย” ทำซ้ำกับ PC เครื่องที่สอง โดยใช้พอร์ต Switch อีกช่อง</p>
      <p>กลับไปที่ “เลือก / ย้าย” เมื่อเชื่อมครบ หากต่อผิด ใช้ปุ่ม “เลิกทำ” บนแถบเครื่องมือ</p>
    </details>
    <details>
      <summary>3. ตั้งค่า IP และพอร์ต</summary>
      <p>คลิก PC เครื่องแรก เปิด “ข้อมูล / IP” แล้วตั้ง IPv4 address เป็น 192.168.1.10 และ CIDR เป็น 24 ตั้งเครื่องที่สองเป็น 192.168.1.20 และ CIDR เป็น 24 บนมือถือเปิด “ตั้งค่าอุปกรณ์” เพื่อดูแผงนี้</p>
      <p>ในแท็บ “พอร์ต” ตรวจว่าพอร์ตที่ใช้เปิดอยู่และอยู่ VLAN เดียวกัน สำหรับตัวอย่างที่มี Switch และ PC ในวงเดียวกันนี้ ยังไม่ต้องตั้ง Gateway หากเชื่อมต่างวงผ่าน Router จึงตั้ง Gateway และเส้นทางให้ครบ</p>
    </details>
    <details>
      <summary>4. ตรวจผังและทดสอบ Ping</summary>
      <p>กด “ตรวจผัง” แล้วแก้รายการที่แจ้ง จากนั้นเปิด “ทดสอบ / Scenario” เลือกต้นทางเป็น PC เครื่องแรก ปลายทางเป็นเครื่องที่สอง และชนิดการทดสอบเป็น “ICMP · Ping” แล้วกด “ทดสอบ Ping”</p>
      <p>ใช้ Capture / Play เพื่อดูการเดินทางของ Packet หากทดสอบไม่ผ่าน ตรวจสาย พอร์ต IP, CIDR และ VLAN ของทั้งสองเครื่อง ผลนี้เป็นการจำลองเครือข่ายในเว็บ</p>
    </details>
    <details>
      <summary>5. บันทึกและดาวน์โหลดงาน</summary>
      <p>เว็บบันทึกการเปลี่ยนแปลงอัตโนมัติ ตรวจสถานะ “บันทึกแล้ว” ที่แถบอุปกรณ์ หากขึ้น “บันทึกไม่สำเร็จ” ให้ตรวจการเชื่อมต่อก่อนทำต่อ</p>
      <p>เปิด “ไฟล์” → “ดาวน์โหลดโปรเจกต์” เพื่อเก็บสำเนางาน เมื่อต้องการใช้ไฟล์ผัง เลือก “นำเข้าผัง” และอ่านคำยืนยันก่อนนำเข้า เพราะจะแทนผังปัจจุบัน</p>
    </details>
    <details>
      <summary>6. ทำงานร่วมกับทีม</summary>
      <p>แชร์รหัสเชิญของห้องให้เพื่อนนำไปกรอกในหน้าเข้าร่วมห้อง ใช้ “แชทและสมาชิก” เพื่อคุยกัน เจ้าของห้องเลือกสิทธิ์แก้ไขได้หรือดูอย่างเดียวใน “ตั้งค่าห้อง”</p>
      <p>เมื่อพร้อมขยายเครือข่าย ลองเพิ่ม Router หรือเริ่มจาก Template ที่มีผังและ Scenario เตรียมไว้แล้ว</p>
    </details>
    <div class="modal-actions"><button class="primary-action compact" @click="$emit('close')">กลับไปสร้างเครือข่าย</button></div>
  </DialogFrame>
</template>

<style scoped>
.network-tutorial { width: min(680px, calc(100vw - 32px)); }
.network-tutorial > p, .network-tutorial details p { font-size: 16px; line-height: 1.6; }
details { border-block-start: 1px solid var(--line); padding-block: 16px; }
summary { cursor: pointer; font-weight: 600; line-height: 1.6; min-height: 44px; display: list-item; padding-block: 8px; }
summary:focus-visible { outline: 2px solid var(--blue); outline-offset: 4px; }
details p { margin-block: 8px 0; }
</style>
