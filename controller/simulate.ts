// API สร้างข้อมูลจำลอง /simulate (เฉพาะเจ้าของร้าน) ใช้ทดสอบระบบ: จำลองลูกค้า และจำลองไรเดอร์
// ข้อมูลที่สร้างจากที่นี่มี is_simulated = 1 ทั้งหมด
import express from "express";
import bcrypt from "bcryptjs";
import { conn } from "../dbconnect";
import { readCount } from "../utils";
import { ROAD_API, SHOP, MAX_KM } from "../planner";

export const router = express.Router();

// รหัสผ่านของไรเดอร์จำลองทุกคน (ใช้ login ทดสอบหน้าไรเดอร์)
const SIM_RIDER_PASSWORD = "123456";
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

// สุ่มพิกัดในวงกลมรัศมี MAX_KM รอบร้าน (ใช้รากที่สองของค่าสุ่ม ให้จุดกระจายทั่ววงกลม ไม่กองตรงกลาง)
function randomPoint(radiusKm = MAX_KM) {
  const km = radiusKm * Math.sqrt(Math.random());
  const angle = Math.random() * 2 * Math.PI;
  // 1 องศาละติจูด ≈ 111.32 กม., 1 องศาลองจิจูด ≈ 111.32 x cos(ละติจูด) กม.
  const lat = SHOP.lat + (km * Math.cos(angle)) / 111.32;
  const lng = SHOP.lng + (km * Math.sin(angle)) / (111.32 * Math.cos((SHOP.lat * Math.PI) / 180));
  return { lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7 };
}

// จุดสุ่มที่ห่างถนนเกินระยะนี้ (เมตร) ถือว่าอยู่กลางน้ำ / กลางทุ่ง ไม่มีบ้านคน ทิ้งไป
const MAX_ROAD_METERS = 80;

// สุ่มพิกัดลูกค้าให้อยู่ริมถนนจริง (ไม่ตกน้ำ ไม่อยู่กลางทุ่ง)
// สุ่มจุดทีละชุด แล้วถาม OSRM (table service) ว่าจุดถนนที่ใกล้ที่สุดอยู่ตรงไหน ห่างกี่เมตร และขับรถจากร้านไปถึงไหม
// จุดที่ใกล้ถนนพอ ใช้พิกัดบนถนนนั้นแทน / โหลดข้อมูลถนนไม่ได้ ใช้จุดสุ่มธรรมดาแทน
async function roadPoints(count: number) {
  const points: { lat: number; lng: number }[] = [];
  const used = new Set<string>(); // พิกัดที่ใช้ไปแล้ว
  try {
    // ลองไม่เกิน 6 ชุด
    for (let round = 0; round < 6 && points.length < count; round++) {
      // สุ่ม 99 จุด (OSRM รับได้ไม่เกิน 100 จุด = ร้าน + 99 จุด)
      // สุ่มในรัศมีสั้นกว่า 3 กม. เล็กน้อย เลื่อนไปริมถนนแล้วจะได้ไม่เกิน 3 กม.
      const list = [];
      for (let i = 0; i < 99; i++) {
        list.push(randomPoint(MAX_KM - MAX_ROAD_METERS / 1000));
      }
      const coords = [SHOP, ...list].map((point) => `${point.lng},${point.lat}`).join(";");
      // sources = จุดสุ่มทุกจุด (1-99), destinations = ร้าน (จุดที่ 0) ได้ตาราง 99 x 1 ขนาดเล็ก
      const sources = list.map((point, i) => i + 1).join(";");
      const response = await fetch(`${ROAD_API}/table/v1/driving/${coords}?sources=${sources}&destinations=0&annotations=distance`, {
        signal: AbortSignal.timeout(6000),
      });
      const data: any = await response.json();
      if (!response.ok || data.code !== "Ok") break;
      for (let i = 0; i < list.length && points.length < count; i++) {
        const road = data.sources[i]; // จุดบนถนนที่ใกล้จุดสุ่มที่สุด location = [ลองจิจูด, ละติจูด]
        if (road.distance > MAX_ROAD_METERS || typeof data.distances[i][0] !== "number") continue;
        const point = { lat: Math.round(road.location[1] * 1e7) / 1e7, lng: Math.round(road.location[0] * 1e7) / 1e7 };
        const key = point.lat + "," + point.lng;
        if (used.has(key)) continue; // ลูกค้าคนละคนไม่อยู่จุดเดียวกัน
        used.add(key);
        points.push(point);
      }
    }
  } catch (error) {
    // เชื่อมต่อ OSRM ไม่ได้ ใช้จุดสุ่มธรรมดาเติมให้ครบด้านล่าง
  }
  while (points.length < count) points.push(randomPoint());
  return points;
}

// POST /simulate/customers สร้างลูกค้าจำลอง (ที่อยู่สุ่มริมถนนในระยะ 3 กม. จากร้าน) body: { "count": 15 }
router.post("/customers", async (req, res) => {
  try {
    const count = readCount((req.body || {}).count, 15, 50);
    if (count === null) {
      return res.status(400).json({ error: "count ต้องเป็นจำนวนเต็ม 1-50" });
    }
    // จับคู่ชื่อ-นามสกุลทุกแบบแล้วสุ่มลำดับ ลูกค้าในรอบเดียวกันจะได้ชื่อไม่ซ้ำกัน
    const names: string[][] = [];
    for (const first of FIRST_NAMES) {
      for (const last of LAST_NAMES) {
        names.push([first, last]);
      }
    }
    names.sort(() => Math.random() - 0.5);
    const points = await roadPoints(count);
    const values = [];
    for (let i = 0; i < count; i++) {
      const point = points[i] as { lat: number; lng: number };
      const name = names[i % names.length] as string[];
      const phone = "08" + String(randomInt(0, 99999999)).padStart(8, "0");
      const address = `${pick(PLACES)} ห้อง ${randomInt(101, 450)} ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม`;
      values.push([name[0], name[1], phone, null, address, point.lat, point.lng, 1]);
    }
    // เพิ่มทุกคนในคำสั่งเดียว (เร็วกว่าเพิ่มทีละคนมาก เพราะฐานข้อมูลอยู่ไกล)
    const sql =
      "INSERT INTO `customers`(`first_name`, `last_name`, `phone`, `email`, `address`, `latitude`, `longitude`, `is_simulated`) VALUES ?";
    const [result] = await conn.query(sql, [values]);
    const insertResult = result as any;
    res.status(201).json({ affected_row: insertResult.affectedRows });
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
    const used = (rows as any[]).map((row) => row.phone);
    const hash = await bcrypt.hash(SIM_RIDER_PASSWORD, 10);
    const phones: string[] = [];
    const values = [];
    let number = 1;
    while (phones.length < count && number <= 99999) {
      const phone = SIM_RIDER_PHONE + String(number).padStart(5, "0");
      number = number + 1;
      if (used.includes(phone)) continue;
      const plate = `${randomInt(1, 9)}${pick(PLATE_LETTERS)} ${randomInt(1000, 9999)}`;
      values.push([phone, hash, "rider", pick(FIRST_NAMES), pick(LAST_NAMES), plate, 1]);
      phones.push(phone);
    }
    // เพิ่มทุกคนในคำสั่งเดียว
    const sql =
      "INSERT INTO `users`(`phone`, `password`, `role`, `first_name`, `last_name`, `license_plate`, `is_simulated`) VALUES ?";
    await conn.query(sql, [values]);
    res.status(201).json({ affected_row: phones.length, phones: phones, password: SIM_RIDER_PASSWORD });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
