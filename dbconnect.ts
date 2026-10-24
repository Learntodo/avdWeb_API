// เชื่อมต่อฐานข้อมูล MySQL แบบ Connection Pool
// ค่าฐานข้อมูลอ่านจากตัวแปร env (ดูค่าได้จากหน้า Overview ของ Aiven) ไม่เขียนรหัสไว้ในโค้ด
import "dotenv/config"; // อ่านค่าจากไฟล์ .env ตอนรันในเครื่อง (บน Vercel ตั้งใน Environment Variables)
import { createPool } from "mysql2/promise";

export const conn = createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST ?? "",
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER ?? "",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "",
  ssl: { rejectUnauthorized: false }, // Aiven บังคับเชื่อมต่อแบบเข้ารหัส (ถ้าใช้ localhost ลบบรรทัดนี้ออก)
  decimalNumbers: true, // ให้คอลัมน์ทศนิยม (ราคา พิกัด) ออกมาเป็นตัวเลข ไม่ใช่ข้อความ
  dateStrings: true, // ให้วันที่ออกมาเป็นข้อความ "YYYY-MM-DD" ตรงกับในฐานข้อมูล
});
