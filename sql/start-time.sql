-- เก็บเวลาที่กด "ออกส่ง" ของแต่ละใบงาน (ส่งให้ถึงภายใน 1 ชั่วโมงนับจากเวลานี้ ไม่ได้ fix 11:30-12:30)
-- รันต่อจาก rider-routes.sql ครั้งเดียว ไม่ลบข้อมูลเดิม (ใบงานเก่าตั้งเป็น 11:30)
SET NAMES utf8mb4;

ALTER TABLE `routes`
  ADD COLUMN `start_time` char(5) NOT NULL DEFAULT '11:30' AFTER `rider_id`;
