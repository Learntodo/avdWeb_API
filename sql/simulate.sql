-- เพิ่มคอลัมน์ is_simulated ให้ลูกค้าและผู้ใช้ (รันต่อจาก routes.sql ครั้งเดียว ไม่ลบข้อมูลเดิม)
-- ใช้แยกข้อมูลที่ระบบจำลองสร้าง (1) ออกจากข้อมูลจริง (0) เพื่อล้างทิ้งได้ทีเดียว เหมือน orders.is_simulated
SET NAMES utf8mb4;

ALTER TABLE `customers` ADD COLUMN `is_simulated` tinyint(1) NOT NULL DEFAULT '0' AFTER `longitude`;
ALTER TABLE `users` ADD COLUMN `is_simulated` tinyint(1) NOT NULL DEFAULT '0' AFTER `is_active`;
