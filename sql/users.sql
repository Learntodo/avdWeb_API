-- ตารางผู้ใช้สำหรับระบบ login (รันต่อจาก schema.sql ครั้งเดียว ไม่ลบข้อมูลเดิม)
SET NAMES utf8mb4;
-- users: เจ้าของร้าน (role = owner) และไรเดอร์ (role = rider) login ด้วยเบอร์โทร + รหัสผ่าน
CREATE TABLE IF NOT EXISTS `users` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `phone` varchar(20) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('owner','rider') NOT NULL DEFAULT 'rider',
  `first_name` varchar(100) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `license_plate` varchar(20) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- บัญชีเจ้าของร้าน เบอร์ 0900000000 (รหัสผ่านแจ้งแยก ในตารางเก็บแค่ค่าที่เข้ารหัสด้วย bcrypt)
-- login แล้วเปลี่ยนรหัสผ่านได้ที่เมนูมุมขวาบนของหน้าเว็บ
INSERT IGNORE INTO `users` (`phone`, `password`, `role`, `first_name`, `last_name`)
VALUES ('0900000000', '$2b$10$HSWXDZkoYounPG1nnl00/.j3sDk6kROG6wBb44tegCwPg2d7oOJG6', 'owner', 'เจ้าของร้าน', 'ส่งด่วนมื้อเที่ยง');
