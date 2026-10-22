// API จัดเส้นทางส่ง /routes (เฉพาะเจ้าของร้าน)
// คำนวณแผน -> เจ้าของร้านเลือกแผน -> บันทึกเป็นใบงาน (ผูกกับไรเดอร์ในระบบ มีเลขใบงานให้ไรเดอร์)
// ส่งได้หลายรอบต่อวัน: ออเดอร์ใหม่ที่ยังไม่อยู่ในใบงาน จัดเป็นรอบใหม่ ให้ไรเดอร์ที่ว่าง (ส่งรอบก่อนเสร็จแล้ว) รับไป
import express from "express";
import crypto from "crypto";
import { conn } from "../dbconnect";
import { thaiDate } from "./order";
import {
  makePlans,
  measureRoute,
  ordersOf,
  summarize,
  loadRoadDistances,
  nowMinutes,
  toTime,
  PlanOrder,
  MAX_ORDERS,
  MAX_MINUTES,
  BOX_COST,
  MAX_KM,
  shopKm,
} from "../planner";
import { RouteResult, RouteRider, StopResult } from "../model/route";

export const router = express.Router();

// ตรวจรูปแบบวันที่ YYYY-MM-DD (ไม่ส่งมา = วันนี้ตามเวลาไทย) ผิดรูปแบบคืนค่า null
export function readDate(value: unknown): string | null {
  if (value === undefined || value === "") return thaiDate();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

// โหลดระยะถนนจริงของร้านและทุกจุดส่ง (true = ได้ระยะถนนจริง, false = ใช้ระยะโดยประมาณ)
function loadRoads(orders: PlanOrder[]): Promise<boolean> {
  return loadRoadDistances(orders.map((o) => ({ lat: o.delivery_latitude, lng: o.delivery_longitude })));
}

// ออเดอร์ "รอส่ง" ของวันที่เลือกที่ยังไม่อยู่ในใบงาน พร้อมชื่อและเบอร์ลูกค้า (รวมที่อยู่นอกเขตส่ง)
async function waitingOrders(date: string): Promise<PlanOrder[]> {
  const [rows] = await conn.query(
    "SELECT orders.id, orders.customer_id, customers.first_name, customers.last_name, customers.phone, orders.delivery_address," +
      " orders.delivery_latitude, orders.delivery_longitude, orders.quantity, orders.total_price" +
      " FROM orders JOIN customers ON customers.id = orders.customer_id" +
      " WHERE orders.delivery_date = ? AND orders.status = 'pending'" +
      " AND orders.id NOT IN (SELECT order_id FROM route_stops) ORDER BY orders.id",
    [date]
  );
  return rows as PlanOrder[];
}

// ออเดอร์ที่ต้องจัดเส้นทางรอบใหม่ = รอส่ง ยังไม่อยู่ในใบงาน และอยู่ในเขตส่ง 3 กม. (นอกเขตไม่จัดให้)
async function loadOrders(date: string): Promise<PlanOrder[]> {
  const orders = await waitingOrders(date);
  return orders.filter((o) => shopKm(o.delivery_latitude, o.delivery_longitude) <= MAX_KM);
}

// ไรเดอร์ที่เปิดใช้งานอยู่ (รับใบงานได้) เรียงตามรหัส
async function activeRiders(): Promise<RouteRider[]> {
  const [rows] = await conn.query(
    "SELECT id, first_name, last_name, phone FROM users WHERE role = 'rider' AND is_active = 1 ORDER BY id"
  );
  return rows as RouteRider[];
}

// ไรเดอร์ที่ว่าง (รับใบงานรอบใหม่ได้) = เปิดใช้งานอยู่ และไม่มีใบงานของวันนั้นที่ยังส่งไม่ครบ
async function freeRiders(date: string): Promise<RouteRider[]> {
  const [rows] = await conn.query(
    "SELECT id, first_name, last_name, phone FROM users WHERE role = 'rider' AND is_active = 1 AND id NOT IN" +
      " (SELECT routes.rider_id FROM routes JOIN route_stops ON route_stops.route_id = routes.id" +
      " JOIN orders ON orders.id = route_stops.order_id" +
      " WHERE routes.delivery_date = ? AND routes.rider_id IS NOT NULL AND orders.status = 'delivering') ORDER BY id",
    [date]
  );
  return rows as RouteRider[];
}

// จำนวนจุดในใบงานนี้ที่ส่งถึงแล้ว (ส่งไปแล้ว ห้ามยกเลิก / เปลี่ยนไรเดอร์)
async function deliveredCount(routeId: number): Promise<number> {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS count FROM route_stops JOIN orders ON orders.id = route_stops.order_id" +
      " WHERE route_stops.route_id = ? AND orders.status = 'delivered'",
    [routeId]
  );
  return Number((rows as any[])[0].count);
}

// ตรวจก่อนจัดเส้นทาง: มีออเดอร์ใหม่ไหม, ไรเดอร์ว่างพอไหม (ผ่านคืนค่า null, ไม่ผ่านคืนข้อความ)
async function checkBeforePlan(orders: PlanOrder[], free: RouteRider[]): Promise<string | null> {
  if (orders.length === 0) {
    return "ไม่มีออเดอร์ใหม่ที่ต้องจัดเส้นทาง (ทุกออเดอร์อยู่ในใบงานแล้ว)";
  }
  if (free.length === 0) {
    const all = await activeRiders();
    if (all.length === 0) return "ยังไม่มีไรเดอร์ในระบบ กรุณาเพิ่มไรเดอร์ก่อน";
    return `ไรเดอร์ทั้ง ${all.length} คนกำลังออกส่งอยู่ รอไรเดอร์ส่งเสร็จก่อน หรือเพิ่มไรเดอร์`;
  }
  const need = Math.ceil(orders.length / MAX_ORDERS);
  if (free.length < need) {
    return `ไรเดอร์ว่างไม่พอ: มีออเดอร์ ${orders.length} รายการ ต้องใช้ไรเดอร์อย่างน้อย ${need} คน (ตอนนี้ว่าง ${free.length} คน)`;
  }
  return null;
}

// เลขเที่ยวล่าสุดของวันนั้น (รอบใหม่นับต่อจากเลขนี้)
async function lastRouteNo(date: string): Promise<number> {
  const [rows] = await conn.query("SELECT MAX(route_no) AS last FROM routes WHERE delivery_date = ?", [date]);
  return Number((rows as any[])[0].last ?? 0);
}

// สุ่มเลขใบงาน 8 ตัว (ตัด 0 O 1 I ที่อ่านสับสนออก) เดาสุ่มได้ยาก เพราะใช้เปิดดูใบงานโดยไม่ต้อง login
function makeCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code = code + chars[crypto.randomInt(chars.length)];
  }
  return code;
}

// จำนวนนาทีจากเวลา from ถึงเวลา to เช่น "11:05" -> "11:47" = 42 (ข้ามเที่ยงคืนก็นับถูก)
function minutesBetween(from: string, to: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (toMin(to) - toMin(from) + 24 * 60) % (24 * 60);
}

// อ่านใบงานที่บันทึกไว้ แล้วจัดเป็นเที่ยว (ใบงาน) พร้อมไรเดอร์และจุดส่งเรียงตามลำดับ
// by = "date" ทุกใบของวันนั้น (หน้าจัดเส้นทาง), "code" ใบเดียวจากเลขใบงาน, "rider" ใบงานของไรเดอร์ในวันที่ date
export async function savedRoutes(by: "date" | "code" | "rider", value: string | number, date?: string) {
  let sql =
    "SELECT routes.id, routes.code, routes.delivery_date, routes.route_no, routes.rider_id, routes.total_km, routes.boxes," +
    " routes.rider_cost, routes.start_time, routes.finish_time, route_stops.seq, route_stops.order_id, route_stops.distance_km," +
    " route_stops.eta, orders.customer_id, orders.quantity, orders.total_price, orders.status, orders.delivery_address," +
    " orders.delivery_latitude, orders.delivery_longitude, customers.first_name, customers.last_name, customers.phone," +
    " users.first_name AS rider_first_name, users.last_name AS rider_last_name, users.phone AS rider_phone" +
    " FROM routes JOIN route_stops ON route_stops.route_id = routes.id" +
    " JOIN orders ON orders.id = route_stops.order_id JOIN customers ON customers.id = orders.customer_id" +
    " LEFT JOIN users ON users.id = routes.rider_id";
  const params: (string | number)[] = [value];
  if (by === "date") {
    sql = sql + " WHERE routes.delivery_date = ? ORDER BY routes.route_no, route_stops.seq";
  } else if (by === "code") {
    sql = sql + " WHERE routes.code = ? ORDER BY route_stops.seq";
  } else {
    sql = sql + " WHERE routes.rider_id = ? AND routes.delivery_date = ? ORDER BY routes.route_no, route_stops.seq";
    params.push(date ?? thaiDate());
  }
  const [rows] = await conn.query(sql, params);

  const routes: (RouteResult & { id: number; code: string; delivery_date: string })[] = [];
  for (const row of rows as any[]) {
    let route = routes.find((r) => r.id === row.id);
    if (!route) {
      route = {
        id: row.id,
        code: row.code,
        delivery_date: row.delivery_date,
        route_no: row.route_no,
        rider:
          row.rider_id === null
            ? null
            : { id: row.rider_id, first_name: row.rider_first_name, last_name: row.rider_last_name, phone: row.rider_phone },
        order_ids: [],
        stops: [],
        total_km: row.total_km,
        boxes: row.boxes,
        sales: 0,
        food_cost: row.boxes * BOX_COST,
        rider_cost: row.rider_cost,
        profit: 0,
        start_time: row.start_time,
        finish_time: row.finish_time,
        finish_minutes: minutesBetween(row.start_time, row.finish_time),
        late_orders: minutesBetween(row.start_time, row.finish_time) > MAX_MINUTES ? 1 : 0,
      };
      routes.push(route);
    }
    const stop: StopResult = {
      seq: row.seq,
      order_id: row.order_id,
      customer_id: row.customer_id,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      delivery_address: row.delivery_address,
      latitude: row.delivery_latitude,
      longitude: row.delivery_longitude,
      quantity: row.quantity,
      distance_km: row.distance_km,
      eta: row.eta,
      minutes: minutesBetween(row.start_time, row.eta),
      status: row.status,
    };
    route.stops.push(stop);
    route.order_ids.push(row.order_id);
    route.sales = route.sales + Number(row.total_price);
    route.profit = Math.round((route.sales - route.food_cost - route.rider_cost) * 100) / 100;
  }
  return routes;
}

// POST /routes/plan คำนวณแผนเส้นทางของออเดอร์ที่ยังไม่อยู่ในใบงาน (ยังไม่บันทึก) ใช้ระยะตามถนนจริง
// body: { "date": "2026-10-20", "round": 0 }
// ตอบ 3 แผนเรียงจากค่าใช้จ่ายน้อยสุด ใช้ไรเดอร์ไม่เกินจำนวนที่ว่าง, round = ครั้งที่กดคำนวณใหม่ (ได้แผนอื่นมาเสนอ)
router.post("/plan", async (req, res) => {
  try {
    const body = req.body || {};
    const date = readDate(body.date);
    if (date === null) {
      return res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
    }
    let round = Number(body.round);
    if (!Number.isInteger(round) || round < 0 || round > 1000) round = 0;

    const orders = await loadOrders(date);
    const riders = await freeRiders(date);
    const problem = await checkBeforePlan(orders, riders);
    if (problem !== null) {
      return res.status(400).json({ error: problem });
    }
    const road = await loadRoads(orders);
    const plans = makePlans(orders, round, riders.length);
    if (plans.length === 0) {
      return res.status(400).json({
        error: `ไรเดอร์ที่ว่าง ${riders.length} คนส่งให้ถึงภายใน 1 ชั่วโมงไม่ได้ กรุณาเพิ่มไรเดอร์`,
      });
    }
    // เลขเที่ยวนับต่อจากรอบก่อนของวันเดียวกัน (ตรงกับเลขที่จะบันทึกจริง)
    const last = await lastRouteNo(date);
    for (const plan of plans) {
      for (const route of plan.routes) route.route_no = route.route_no + last;
    }
    // road_distance: true = ระยะตามถนนจริง, false = ระยะโดยประมาณ (เชื่อมต่อแผนที่ถนนไม่ได้)
    res.json({ date: date, road_distance: road, riders_available: riders.length, plans: plans });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /routes กด "ออกส่ง": ยืนยันแผนแล้วบันทึกเป็นใบงานรอบใหม่ (ใบงานรอบก่อนยังอยู่) และเปลี่ยนออเดอร์เป็น "กำลังส่ง"
// เวลาที่กด = เวลาออกจากร้าน ทุกจุดต้องถึงภายใน 1 ชั่วโมงหลังจากนี้
// body: { "date": "2026-10-20", "routes": [[5, 2], [7], [1, 9, 3]] } (รหัสออเดอร์ของแต่ละเที่ยว เรียงตามลำดับส่ง)
// ระบบคำนวณระยะทาง / ค่าไรเดอร์ ใหม่เองทั้งหมด ไม่เชื่อตัวเลขที่ส่งมา และแจกใบงานให้ไรเดอร์ที่ว่างตามลำดับรหัส
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const date = readDate(body.date);
    if (date === null) {
      return res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
    }
    const list = body.routes;
    if (!Array.isArray(list) || list.length === 0 || list.length > 500) {
      return res.status(400).json({ error: "routes ต้องเป็นรายการเที่ยว" });
    }

    // ตรวจว่าทุกเที่ยวมี 1-3 ออเดอร์ และไม่มีออเดอร์ซ้ำ
    const ids: number[] = [];
    for (const route of list) {
      if (!Array.isArray(route) || route.length < 1 || route.length > MAX_ORDERS) {
        return res.status(400).json({ error: `ไรเดอร์ 1 คนรับได้ 1-${MAX_ORDERS} ออเดอร์` });
      }
      for (const id of route) {
        if (!Number.isInteger(id) || ids.includes(id)) {
          return res.status(400).json({ error: "รหัสออเดอร์ไม่ถูกต้อง หรือซ้ำกัน" });
        }
        ids.push(id);
      }
    }

    // ต้องครอบคลุมออเดอร์ที่ยังไม่อยู่ในใบงานครบทุกรายการพอดี และไรเดอร์ที่ว่างต้องพอ
    const orders = await loadOrders(date);
    const riders = await freeRiders(date);
    const problem = await checkBeforePlan(orders, riders);
    if (problem !== null) {
      return res.status(400).json({ error: problem });
    }
    if (orders.length !== ids.length || !orders.every((o) => ids.includes(o.id))) {
      return res.status(400).json({ error: "แผนไม่ตรงกับออเดอร์ปัจจุบัน กรุณาคำนวณใหม่" });
    }
    if (list.length > riders.length) {
      return res.status(400).json({ error: `แผนนี้ใช้ไรเดอร์ ${list.length} คน แต่ว่างอยู่ ${riders.length} คน` });
    }
    await loadRoads(orders);
    // เวลาที่กดออกส่ง = เวลาออกจากร้าน คิดเวลาถึงแต่ละจุดจากตอนนี้
    const start = nowMinutes();
    const plan = summarize(list.map((route: number[]) => measureRoute(ordersOf(orders, route), start)));
    if (plan.late_orders > 0) {
      return res.status(400).json({ error: "แผนนี้มีจุดที่ส่งถึงเกิน 1 ชั่วโมง" });
    }

    // บันทึกทั้งหมดใน Transaction เดียว (ผิดพลาดตรงไหน ยกเลิกทั้งหมด)
    const last = await lastRouteNo(date); // เลขเที่ยวนับต่อจากรอบก่อน
    const db = await conn.getConnection();
    const codes: { route_no: number; code: string; rider_id: number }[] = [];
    try {
      await db.beginTransaction();
      for (let i = 0; i < plan.routes.length; i++) {
        const route = plan.routes[i] as RouteResult;
        const rider = riders[i] as RouteRider; // เที่ยวแรกของรอบ -> ไรเดอร์ที่ว่างคนแรก, เที่ยวที่สอง -> คนที่สอง, ...
        const routeNo = last + route.route_no;
        const code = makeCode();
        const [result] = await db.query(
          "INSERT INTO `routes`(`code`, `delivery_date`, `route_no`, `rider_id`, `start_time`, `total_km`, `boxes`, `rider_cost`, `finish_time`) VALUES (?,?,?,?,?,?,?,?,?)",
          [code, date, routeNo, rider.id, toTime(start), route.total_km, route.boxes, route.rider_cost, route.finish_time]
        );
        const routeId = (result as any).insertId;
        const stops = route.stops.map((s) => [routeId, s.order_id, s.seq, s.distance_km, s.eta]);
        await db.query("INSERT INTO `route_stops`(`route_id`, `order_id`, `seq`, `distance_km`, `eta`) VALUES ?", [stops]);
        codes.push({ route_no: routeNo, code: code, rider_id: rider.id });
      }
      await db.query("UPDATE orders SET status = 'delivering' WHERE id IN (?)", [ids]);
      await db.commit();
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
    res.status(201).json({ affected_row: codes.length, routes: codes });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /routes?date=2026-10-20 ใบงานทุกรอบของวันนั้น พร้อมไรเดอร์ เวลาออกส่ง และสรุปยอดทั้งวัน
router.get("/", async (req, res) => {
  try {
    const date = readDate(req.query.date);
    if (date === null) {
      return res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
    }
    const routes = await savedRoutes("date", date);
    const riders = await activeRiders();
    const free = await freeRiders(date);
    // ออเดอร์ "รอส่ง" ที่ยังไม่อยู่ในใบงาน (รับเพิ่มหลังออกส่งไปแล้ว -> จัดเป็นรอบใหม่) แยกที่อยู่นอกเขตส่งออกมา
    const all = await waitingOrders(date);
    const waiting = all.filter((o) => shopKm(o.delivery_latitude, o.delivery_longitude) <= MAX_KM);
    const outside = all.filter((o) => shopKm(o.delivery_latitude, o.delivery_longitude) > MAX_KM);
    let sales = 0;
    let riderCost = 0;
    let boxes = 0;
    let km = 0;
    let orders = 0;
    let delivered = 0;
    let finish = "";
    let finishMinutes = 0;
    let finishAt = -1;
    const riderIds: number[] = [];
    // รอบที่ออกส่ง (ใบงานที่กดออกส่งพร้อมกัน = เวลาออกเดียวกัน)
    const rounds: { start_time: string; routes: number; orders: number; delivered: number }[] = [];
    for (const r of routes) {
      const done = r.stops.filter((s) => s.status === "delivered").length;
      sales = sales + r.sales;
      riderCost = riderCost + r.rider_cost;
      boxes = boxes + r.boxes;
      km = km + r.total_km;
      orders = orders + r.stops.length;
      delivered = delivered + done;
      if (r.rider && !riderIds.includes(r.rider.id)) riderIds.push(r.rider.id);
      // เวลาส่งเสร็จของทั้งวัน = จุดสุดท้ายของรอบที่ส่งเสร็จช้าที่สุด
      const at = minutesBetween("00:00", r.start_time as string) + r.finish_minutes;
      if (at > finishAt) {
        finishAt = at;
        finish = r.finish_time;
        finishMinutes = r.finish_minutes;
      }
      let round = rounds.find((x) => x.start_time === r.start_time);
      if (!round) {
        round = { start_time: r.start_time as string, routes: 0, orders: 0, delivered: 0 };
        rounds.push(round);
      }
      round.routes = round.routes + 1;
      round.orders = round.orders + r.stops.length;
      round.delivered = round.delivered + done;
    }
    rounds.sort((a, b) => a.start_time.localeCompare(b.start_time));
    res.json({
      date: date,
      riders: riderIds.length,
      riders_available: riders.length,
      riders_free: free.length, // ไรเดอร์ที่ว่าง รับรอบใหม่ได้
      orders: orders,
      delivered: delivered, // ส่งถึงแล้วกี่ออเดอร์
      waiting: waiting.length,
      outside: outside.map((o) => o.id), // ออเดอร์ที่อยู่นอกเขตส่ง 3 กม. (ส่งไม่ได้ ต้องแก้จุดส่งหรือยกเลิก)
      boxes: boxes,
      total_km: Math.round(km * 100) / 100,
      sales: sales,
      food_cost: boxes * BOX_COST,
      rider_cost: Math.round(riderCost * 100) / 100,
      profit: Math.round((sales - boxes * BOX_COST - riderCost) * 100) / 100,
      start_time: rounds.length > 0 ? rounds[rounds.length - 1]!.start_time : null, // เวลาออกส่งรอบล่าสุด
      finish_time: finish,
      finish_minutes: finishMinutes,
      late_orders: routes.filter((r) => r.late_orders > 0).length,
      rounds: rounds,
      routes: routes,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /routes/{id} เปลี่ยนไรเดอร์ของใบงาน body: { "rider_id": 8 }
// ถ้าไรเดอร์คนนั้นกำลังถือใบงานอื่นที่ยังไม่ได้เริ่มส่ง จะสลับใบงานกันให้
router.put("/:id", async (req, res) => {
  try {
    const riderId = Number((req.body || {}).rider_id);
    const [rows] = await conn.query("SELECT id, delivery_date, rider_id FROM routes WHERE id = ?", [req.params.id]);
    const route = (rows as any[])[0];
    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }
    if ((await deliveredCount(route.id)) > 0) {
      return res.status(400).json({ error: "ไรเดอร์เริ่มส่งเที่ยวนี้แล้ว เปลี่ยนไรเดอร์ไม่ได้" });
    }
    const riders = await activeRiders();
    if (!riders.some((r) => r.id === riderId)) {
      return res.status(400).json({ error: "ไม่พบไรเดอร์คนนี้ หรือไรเดอร์ถูกปิดใช้งาน" });
    }
    // ใบงานอื่นของไรเดอร์คนใหม่ในวันเดียวกันที่ยังส่งไม่ครบ (ไรเดอร์ไม่ว่าง)
    const [busyRows] = await conn.query(
      "SELECT DISTINCT routes.id FROM routes JOIN route_stops ON route_stops.route_id = routes.id" +
        " JOIN orders ON orders.id = route_stops.order_id" +
        " WHERE routes.delivery_date = ? AND routes.rider_id = ? AND routes.id <> ? AND orders.status = 'delivering'",
      [route.delivery_date, riderId, route.id]
    );
    for (const busy of busyRows as any[]) {
      if ((await deliveredCount(busy.id)) > 0) {
        return res.status(400).json({ error: "ไรเดอร์คนนี้กำลังส่งเที่ยวอื่นอยู่ เลือกคนอื่น" });
      }
    }
    // สลับ: ใบงานที่ไรเดอร์คนใหม่ถืออยู่ (ยังไม่เริ่มส่ง) ได้ไรเดอร์คนเก่าไปแทน
    for (const busy of busyRows as any[]) {
      await conn.query("UPDATE routes SET rider_id = ? WHERE id = ?", [route.rider_id, busy.id]);
    }
    const [result] = await conn.query("UPDATE routes SET rider_id = ? WHERE id = ?", [riderId, route.id]);
    res.status(200).json({ affected_row: (result as any).affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /routes/{id} ยกเลิกใบงาน 1 เที่ยว ออเดอร์ในเที่ยวนั้นกลับเป็น "รอส่ง" (นำไปจัดรอบใหม่ได้)
// ถ้าไรเดอร์ส่งของถึงลูกค้าไปแล้วบางจุด ยกเลิกไม่ได้
router.delete("/:id", async (req, res) => {
  try {
    const [rows] = await conn.query("SELECT id FROM routes WHERE id = ?", [req.params.id]);
    const route = (rows as any[])[0];
    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }
    if ((await deliveredCount(route.id)) > 0) {
      return res.status(400).json({ error: "ไรเดอร์ส่งของถึงลูกค้าไปแล้ว ยกเลิกเที่ยวนี้ไม่ได้" });
    }
    await conn.query(
      "UPDATE orders SET status = 'pending' WHERE status = 'delivering' AND id IN" +
        " (SELECT order_id FROM route_stops WHERE route_id = ?)",
      [route.id]
    );
    const [result] = await conn.query("DELETE FROM routes WHERE id = ?", [route.id]);
    const deleteResult = result as any;
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
