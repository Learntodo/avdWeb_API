// API ระบบจำลองข้อมูล /simulate (เฉพาะเจ้าของร้าน) ใช้ทดสอบระบบตั้งแต่ต้นจนจบผ่านหน้าเว็บ
// ลูกค้าจำลอง -> ไรเดอร์จำลอง -> ออเดอร์จำลอง (POST /orders/simulate) -> จัดเส้นทาง -> เปิดใบงาน -> ส่งเสร็จ -> ล้างทิ้ง
// ข้อมูลที่สร้างจากที่นี่มี is_simulated = 1 ทั้งหมด ล้างทิ้งได้โดยไม่กระทบข้อมูลจริง
import express from "express";
import bcrypt from "bcryptjs";
import { conn } from "../dbconnect";
import { readDate } from "./route";
import { SHOP } from "../planner";

export const router = express.Router();

// รัศมีที่ร้านส่งได้ (กม. เส้นตรงจากร้าน) ตามโจทย์โปรเจกต์
export const SIM_RADIUS_KM = 3;
// รหัสผ่านของไรเดอร์จำลองทุกคน (ใช้ login ทดสอบหน้าไรเดอร์)
export const SIM_RIDER_PASSWORD = "123456";
// เบอร์ไรเดอร์จำลองเริ่มที่ 0990000001, 0990000002, ...
const SIM_RIDER_PHONE = "09900";

const FIRST_NAMES = ["สมชาย", "สมหญิง", "วิชัย", "มาลี", "ธนพล", "ปิยะนุช", "กิตติ", "อรุณี", "ณัฐวุฒิ", "สุดารัตน์", "พงศกร", "จันทร์เพ็ญ", "อนุชา", "กมลชนก", "ศุภชัย", "วรรณา"];
const LAST_NAMES = ["ใจดี", "รักเรียน", "มีสุข", "แสงทอง", "ศรีสุข", "บุญมา", "พรหมมา", "ทองดี", "สายบุญ", "คำแก้ว", "ชัยมงคล", "วงศ์ใหญ่"];
const PLACES = ["หอพักริมบึง", "หอพักสุขสบาย", "คณะวิทยาการสารสนเทศ", "คณะวิศวกรรมศาสตร์", "ตึกอธิการบดี", "อาคารเรียนรวม", "หอพักบ้านสวน", "ร้านถ่ายเอกสารหน้ามอ", "คอนโดท่าขอนยาง", "หอพักเพชรรัตน์"];
const PLATE_LETTERS = ["กข", "กค", "ขง", "คต", "งจ", "จฉ", "ชพ", "ฒม"];

// สุ่มจำนวนเต็มตั้งแต่ min ถึง max
function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// สุ่ม 1 ค่าจากรายการ
function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)] as T;
}

// อ่านจำนวนที่ส่งมา (ไม่ส่งมา = ค่าเริ่มต้น) ต้องเป็นจำนวนเต็ม 1 ถึง max ไม่งั้นคืนค่า null
export function readCount(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > max) return null;
  return count;
}

// สุ่มพิกัดในวงกลมรัศมี SIM_RADIUS_KM รอบร้าน (ใช้รากที่สองของค่าสุ่ม ให้จุดกระจายทั่ววงกลม ไม่กองตรงกลาง)
function randomPoint() {
  const km = SIM_RADIUS_KM * Math.sqrt(Math.random());
  const angle = Math.random() * 2 * Math.PI;
  // 1 องศาละติจูด ≈ 111.32 กม., 1 องศาลองจิจูด ≈ 111.32 x cos(ละติจูด) กม.
  const lat = SHOP.lat + (km * Math.cos(angle)) / 111.32;
  const lng = SHOP.lng + (km * Math.sin(angle)) / (111.32 * Math.cos((SHOP.lat * Math.PI) / 180));
  return { lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7 };
}

// GET /simulate?date=2026-10-21 สรุปข้อมูลจำลองที่มีอยู่ และสถานะออเดอร์ / ใบงานของวันที่เลือก
router.get("/", async (req, res) => {
  try {
    const date = readDate(req.query.date);
    if (date === null) {
      return res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
    }
    const [counts] = await conn.query(
      "SELECT (SELECT COUNT(*) FROM customers WHERE is_simulated = 1) AS customers," +
        " (SELECT COUNT(*) FROM orders WHERE is_simulated = 1) AS orders," +
        " (SELECT COUNT(*) FROM users WHERE role = 'rider' AND is_simulated = 1) AS riders"
    );
    const [statuses] = await conn.query(
      "SELECT status, COUNT(*) AS count FROM orders WHERE delivery_date = ? GROUP BY status",
      [date]
    );
    const [riders] = await conn.query(
      "SELECT id, phone, first_name, last_name, license_plate FROM users WHERE role = 'rider' AND is_simulated = 1 ORDER BY phone"
    );
    const [routes] = await conn.query(
      "SELECT route_no, code FROM routes WHERE delivery_date = ? ORDER BY route_no",
      [date]
    );
    const day: any = { pending: 0, delivering: 0, delivered: 0, cancelled: 0 };
    for (const row of statuses as any[]) {
      day[row.status] = row.count;
    }
    res.json({
      ...(counts as any[])[0],
      date: date,
      day: day,
      rider_password: SIM_RIDER_PASSWORD,
      sim_riders: riders,
      routes: routes,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /simulate/customers สร้างลูกค้าจำลอง (ที่อยู่สุ่มในระยะ 3 กม. จากร้าน) body: { "count": 15 }
router.post("/customers", async (req, res) => {
  try {
    const count = readCount((req.body || {}).count, 15, 50);
    if (count === null) {
      return res.status(400).json({ error: "count ต้องเป็นจำนวนเต็ม 1-50" });
    }
    let affected = 0;
    for (let i = 0; i < count; i++) {
      const point = randomPoint();
      const phone = "08" + String(randomInt(0, 99999999)).padStart(8, "0");
      const address = `${pick(PLACES)} ห้อง ${randomInt(101, 450)} ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม`;
      let sql =
        "INSERT INTO `customers`(`first_name`, `last_name`, `phone`, `email`, `address`, `latitude`, `longitude`, `is_simulated`) VALUES (?,?,?,?,?,?,?,1)";
      const [result] = await conn.query(sql, [pick(FIRST_NAMES), pick(LAST_NAMES), phone, null, address, point.lat, point.lng]);
      const insertResult = result as any;
      affected += insertResult.affectedRows;
    }
    res.status(201).json({ affected_row: affected });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /simulate/riders สร้างไรเดอร์จำลอง เบอร์ 0990000001, 0990000002, ... รหัสผ่าน 123456 body: { "count": 5 }
router.post("/riders", async (req, res) => {
  try {
    const count = readCount((req.body || {}).count, 5, 20);
    if (count === null) {
      return res.status(400).json({ error: "count ต้องเป็นจำนวนเต็ม 1-20" });
    }
    // หาเบอร์ที่ใช้ไปแล้ว จะได้ไม่ซ้ำ (เบอร์ซ้ำ ฐานข้อมูลไม่ยอมบันทึก)
    const [rows] = await conn.query("SELECT phone FROM users WHERE phone LIKE ?", [SIM_RIDER_PHONE + "%"]);
    const used = (rows as any[]).map((r) => r.phone);
    const hash = await bcrypt.hash(SIM_RIDER_PASSWORD, 10);
    const phones: string[] = [];
    let no = 1;
    while (phones.length < count && no <= 99999) {
      const phone = SIM_RIDER_PHONE + String(no).padStart(5, "0");
      no = no + 1;
      if (used.includes(phone)) continue;
      const plate = `${randomInt(1, 9)}${pick(PLATE_LETTERS)} ${randomInt(1000, 9999)}`;
      let sql =
        "INSERT INTO `users`(`phone`, `password`, `role`, `first_name`, `last_name`, `license_plate`, `is_simulated`) VALUES (?,?,'rider',?,?,?,1)";
      await conn.query(sql, [phone, hash, pick(FIRST_NAMES), pick(LAST_NAMES), plate]);
      phones.push(phone);
    }
    res.status(201).json({ affected_row: phones.length, phones: phones, password: SIM_RIDER_PASSWORD });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /simulate/deliver จำลองว่าไรเดอร์ส่งของเสร็จ: ออเดอร์ "กำลังส่ง" ของวันนั้นเปลี่ยนเป็น "ส่งแล้ว"
// body: { "date": "2026-10-21" }
router.post("/deliver", async (req, res) => {
  try {
    const date = readDate((req.body || {}).date);
    if (date === null) {
      return res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
    }
    const [result] = await conn.query(
      "UPDATE orders SET status = 'delivered' WHERE delivery_date = ? AND status = 'delivering'",
      [date]
    );
    const updateResult = result as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /simulate ล้างข้อมูลจำลองทั้งหมด: ใบงานที่มีออเดอร์จำลอง, ออเดอร์จำลอง (รวมออเดอร์ของลูกค้าจำลอง),
// ลูกค้าจำลอง และไรเดอร์จำลอง (ข้อมูลจริง is_simulated = 0 ไม่ถูกลบ)
router.delete("/", async (req, res) => {
  try {
    const simOrders = "(orders.is_simulated = 1 OR orders.customer_id IN (SELECT id FROM customers WHERE is_simulated = 1))";
    // ลบทั้งหมดใน Transaction เดียว (ผิดพลาดตรงไหน ยกเลิกทั้งหมด)
    const db = await conn.getConnection();
    const deleted = { routes: 0, orders: 0, customers: 0, riders: 0 };
    try {
      await db.beginTransaction();
      // ใบงานที่มีออเดอร์จำลองอยู่ ใช้ต่อไม่ได้แล้ว: ออเดอร์จริงในใบงานนั้นกลับเป็น "รอส่ง" แล้วลบใบงานทิ้ง
      const [rows] = await db.query(
        "SELECT DISTINCT route_stops.route_id FROM route_stops JOIN orders ON orders.id = route_stops.order_id WHERE " + simOrders
      );
      const routeIds = (rows as any[]).map((r) => r.route_id);
      if (routeIds.length > 0) {
        await db.query(
          "UPDATE orders SET status = 'pending' WHERE status = 'delivering' AND id IN (SELECT order_id FROM route_stops WHERE route_id IN (?))",
          [routeIds]
        );
        const [routes] = await db.query("DELETE FROM routes WHERE id IN (?)", [routeIds]);
        deleted.routes = (routes as any).affectedRows;
      }
      const [orders] = await db.query("DELETE FROM orders WHERE " + simOrders);
      const [customers] = await db.query("DELETE FROM customers WHERE is_simulated = 1");
      const [riders] = await db.query("DELETE FROM users WHERE role = 'rider' AND is_simulated = 1");
      await db.commit();
      deleted.orders = (orders as any).affectedRows;
      deleted.customers = (customers as any).affectedRows;
      deleted.riders = (riders as any).affectedRows;
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
    res.status(200).json(deleted);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
