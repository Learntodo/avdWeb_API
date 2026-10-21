-- ผูกใบงานกับไรเดอร์ (รันต่อจาก simulate.sql ครั้งเดียว ไม่ลบข้อมูลเดิม)
-- routes.rider_id = ไรเดอร์ที่รับใบงาน ลบไรเดอร์แล้วใบงานยังอยู่ (rider_id เป็น NULL)
SET NAMES utf8mb4;

ALTER TABLE `routes`
  ADD COLUMN `rider_id` int unsigned DEFAULT NULL AFTER `route_no`,
  ADD KEY `rider_id` (`rider_id`),
  ADD CONSTRAINT `routes_ibfk_1` FOREIGN KEY (`rider_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;
