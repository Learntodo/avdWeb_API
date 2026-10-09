// เชื่อมต่อฐานข้อมูล MySQL แบบ Connection Pool
// ใส่ค่าฐานข้อมูลของตัวเอง (ดูได้จากหน้า Overview ของ Aiven)
import { createPool } from "mysql2/promise";

export const conn = createPool({
  connectionLimit: 10,
  host: "mysql-30237a29-lunch-delivery.f.aivencloud.com",
  port: 20062,
  user: "avnadmin",
  password: "AVNS_v83vWcRV1raddzop-wp",
  database: "defaultdb",
  ssl: { rejectUnauthorized: false }, // Aiven บังคับเชื่อมต่อแบบเข้ารหัส (ถ้าใช้ localhost ลบบรรทัดนี้ออก)
});
