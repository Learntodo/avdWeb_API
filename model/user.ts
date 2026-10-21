// โมเดลผู้ใช้ ตาราง users (เจ้าของร้าน และไรเดอร์)
export interface User {
  id: number;
  phone: string; // ใช้เป็นชื่อผู้ใช้ตอน login
  password: string; // รหัสผ่านที่เข้ารหัสด้วย bcrypt แล้ว
  role: "owner" | "rider";
  first_name: string;
  last_name: string;
  license_plate: string | null; // ทะเบียนรถ (เฉพาะไรเดอร์)
  is_active: number; // 1 = ใช้งานได้, 0 = ปิดใช้งาน (login ไม่ได้)
  is_simulated?: number; // 1 = ไรเดอร์จำลอง
  created_at: string;
  updated_at: string;
}
