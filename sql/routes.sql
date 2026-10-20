-- ตารางใบงานไรเดอร์ (รันต่อจาก schema.sql และ users.sql ครั้งเดียว ไม่ลบข้อมูลเดิม)
SET NAMES utf8mb4;

-- routes: ใบงาน 1 ใบ = ไรเดอร์ 1 คน ใน 1 วัน, code = เลขใบงานที่ไรเดอร์ใช้เปิดดู
CREATE TABLE IF NOT EXISTS `routes` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `code` char(8) NOT NULL,
  `delivery_date` date NOT NULL,
  `route_no` smallint unsigned NOT NULL,
  `total_km` decimal(6,2) NOT NULL,
  `boxes` smallint unsigned NOT NULL,
  `rider_cost` decimal(10,2) NOT NULL,
  `finish_time` char(5) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `delivery_date` (`delivery_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- route_stops: จุดส่งในใบงาน เรียงตาม seq (1 ออเดอร์อยู่ได้ใบงานเดียว)
-- ลบใบงาน หรือลบออเดอร์ จุดส่งที่เกี่ยวข้องถูกลบตามอัตโนมัติ
CREATE TABLE IF NOT EXISTS `route_stops` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `route_id` int unsigned NOT NULL,
  `order_id` int unsigned NOT NULL,
  `seq` tinyint unsigned NOT NULL,
  `distance_km` decimal(6,2) NOT NULL,
  `eta` char(5) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_id` (`order_id`),
  KEY `route_id` (`route_id`),
  CONSTRAINT `route_stops_ibfk_1` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `route_stops_ibfk_2` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
