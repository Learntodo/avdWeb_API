-- โครงสร้างตารางหลักของระบบ (ลูกค้าและออเดอร์)
-- รันในฐานข้อมูลที่เลือกไว้ (หรือใช้ npm run db:setup) สร้างเฉพาะตารางที่ยังไม่มี ไม่ลบข้อมูลเดิม
-- customers: ข้อมูลลูกค้าและพิกัดที่อยู่
CREATE TABLE IF NOT EXISTS `customers` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `first_name` varchar(100) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `address` text NOT NULL,
  `latitude` decimal(10,7) NOT NULL,
  `longitude` decimal(10,7) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `customers_chk_1` CHECK ((`latitude` between -(90) and 90)),
  CONSTRAINT `customers_chk_2` CHECK ((`longitude` between -(180) and 180))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- orders: ออเดอร์ข้าวกล่อง (1–3 กล่อง) total_price คำนวณอัตโนมัติจาก quantity × unit_price
CREATE TABLE IF NOT EXISTS `orders` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `customer_id` int unsigned NOT NULL,
  `quantity` tinyint unsigned NOT NULL,
  `unit_price` decimal(10,2) NOT NULL DEFAULT '65.00',
  `total_price` decimal(10,2) GENERATED ALWAYS AS ((`quantity` * `unit_price`)) STORED,
  `delivery_address` text NOT NULL,
  `delivery_latitude` decimal(10,7) NOT NULL,
  `delivery_longitude` decimal(10,7) NOT NULL,
  `delivery_date` date NOT NULL,
  `status` enum('pending','delivering','delivered','cancelled') NOT NULL DEFAULT 'pending',
  `is_simulated` tinyint(1) NOT NULL DEFAULT '0',
  `note` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `customer_id` (`customer_id`),
  CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `orders_chk_1` CHECK ((`quantity` between 1 and 3)),
  CONSTRAINT `orders_chk_2` CHECK ((`unit_price` >= 0)),
  CONSTRAINT `orders_chk_3` CHECK ((`delivery_latitude` between -(90) and 90)),
  CONSTRAINT `orders_chk_4` CHECK ((`delivery_longitude` between -(180) and 180))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

