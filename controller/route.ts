// API จัดเส้นทางส่ง /routes (เฉพาะเจ้าของร้าน)
// ขั้นตอน: คำนวณแผน -> เจ้าของร้านเลือกแผน -> กด "ออกส่ง" บันทึกเป็นใบงาน (ผูกกับไรเดอร์ มีเลขใบงานให้ไรเดอร์)
// ส่งได้หลายรอบต่อวัน: ออเดอร์ใหม่ที่ยังไม่อยู่ในใบงาน จัดเป็นรอบใหม่ ให้ไรเดอร์ที่ว่าง (ส่งรอบก่อนเสร็จแล้ว) รับไป
import express from "express";
import crypto from "crypto";
import { conn } from "../dbconnect";
import { thaiDate, readDate, minutesBetween } from "../utils";
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
import { RouteResult, RouteRider, SavedRoute, StopResult } from "../model/route";

export const router = express.Router();

// =====================================================================
// ฟังก์ชันช่วย: อ่านข้อมูลจากฐานข้อมูล
// =====================================================================

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

// ออเดอร์นี้อยู่ในเขตส่ง 3 กม. ไหม
function inArea(order: PlanOrder): boolean {
  return shopKm(order.delivery_latitude, order.delivery_longitude) <= MAX_KM;
}

// ออเดอร์ที่ต้องจัดเส้นทางรอบใหม่ = รอส่ง ยังไม่อยู่ในใบงาน และอยู่ในเขตส่ง (นอกเขตไม่จัดให้)
async function loadOrders(date: string): Promise<PlanOrder[]> {
  const orders = await waitingOrders(date);
  return orders.filter((order) => inArea(order));
}

// โหลดระยะถนนจริงของร้านและทุกจุดส่ง (true = ได้ระยะถนนจริง, false = ใช้ระยะโดยประมาณ)
function loadRoads(orders: PlanOrder[]): Promise<boolean> {
  const points = orders.map((order) => ({ lat: order.delivery_latitude, lng: order.delivery_longitude }));
  return loadRoadDistances(points);
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

// เลขเที่ยวล่าสุดของวันนั้น (รอบใหม่นับต่อจากเลขนี้)
async function lastRouteNo(date: string): Promise<number> {
  const [rows] = await conn.query("SELECT MAX(route_no) AS last FROM routes WHERE delivery_date = ?", [date]);
  return Number((rows as any[])[0].last ?? 0);
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
  const need = Math.ceil(orders.length / MAX_ORDERS); // ไรเดอร์ที่ต้องใช้อย่างน้อย
  if (free.length < need) {
    return `ไรเดอร์ว่างไม่พอ: มีออเดอร์ ${orders.length} รายการ ต้องใช้ไรเดอร์อย่างน้อย ${need} คน (ตอนนี้ว่าง ${free.length} คน)`;
  }
  return null;
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

// อ่านใบงานที่บันทึกไว้ แล้วจัดเป็นเที่ยว พร้อมไรเดอร์และจุดส่งเรียงตามลำดับ
// by = "date"  ทุกใบของวันนั้น (หน้าจัดเส้นทาง)
// by = "code"  ใบเดียวจากเลขใบงาน
// by = "rider" ใบงานของไรเดอร์ในวันที่ date
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

  // 1 แถว = จุดส่ง 1 จุด นำแถวของใบงานเดียวกันมารวมเป็นเที่ยวเดียว
  const routes: SavedRoute[] = [];
  for (const row of rows as any[]) {
    let route = routes.find((item) => item.id === row.id);
    if (!route) {
      // เจอใบงานนี้ครั้งแรก สร้างเที่ยวใหม่
      const minutes = minutesBetween(row.start_time, row.finish_time);
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
        finish_minutes: minutes,
        late_orders: minutes > MAX_MINUTES ? 1 : 0,
      };
      routes.push(route);
    }
    // เพิ่มจุดส่งของแถวนี้เข้าไปในเที่ยว
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

// =====================================================================
// API
// =====================================================================

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
      for (const route of plan.routes) {
        route.route_no = route.route_no + last;
      }
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
      return res.status(400).json({ error: "routes ต้องเป็นรายการใบงาน" });
    }

    // 1. ตรวจว่าทุกเที่ยวมี 1-3 ออเดอร์ และไม่มีออเดอร์ซ้ำ
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

    // 2. ต้องครอบคลุมออเดอร์ที่ยังไม่อยู่ในใบงานครบทุกรายการพอดี และไรเดอร์ที่ว่างต้องพอ
    const orders = await loadOrders(date);
    const riders = await freeRiders(date);
    const problem = await checkBeforePlan(orders, riders);
    if (problem !== null) {
      return res.status(400).json({ error: problem });
    }
    const sameOrders = orders.length === ids.length && orders.every((order) => ids.includes(order.id));
    if (!sameOrders) {
      return res.status(400).json({ error: "มีออเดอร์เปลี่ยนไประหว่างนี้ กรุณากด “ให้ระบบจัดเส้นทาง” ใหม่อีกครั้ง" });
    }
    if (list.length > riders.length) {
      return res.status(400).json({ error: `แผนนี้ใช้ไรเดอร์ ${list.length} คน แต่ว่างอยู่ ${riders.length} คน` });
    }

    // 3. คำนวณใหม่ โดยใช้เวลาที่กดออกส่ง = เวลาออกจากร้าน
    await loadRoads(orders);
    const start = nowMinutes();
    const plan = summarize(list.map((route: number[]) => measureRoute(ordersOf(orders, route), start)));
    if (plan.late_orders > 0) {
      return res.status(400).json({ error: "แผนนี้มีบ้านที่ส่งไม่ทันภายใน 1 ชั่วโมง" });
    }

    // 4. บันทึกทั้งหมดใน Transaction เดียว (ผิดพลาดตรงไหน ยกเลิกทั้งหมด)
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
        // จุดส่งทุกจุดของเที่ยวนี้ เพิ่มในคำสั่งเดียว
        const stops = route.stops.map((stop) => [routeId, stop.order_id, stop.seq, stop.distance_km, stop.eta]);
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
    const waiting = all.filter((order) => inArea(order));
    const outside = all.filter((order) => !inArea(order));

    // รวมยอดทั้งวัน
    let sales = 0;
    let riderCost = 0;
    let boxes = 0;
    let km = 0;
    let orderCount = 0;
    let deliveredTotal = 0;
    let finishTime = "";
    let finishMinutes = 0;
    let finishAt = -1; // เวลาส่งเสร็จ (นาทีนับจากเที่ยงคืน) ของรอบที่เสร็จช้าที่สุด
    const riderIds: number[] = []; // ไรเดอร์ที่ได้ใบงานวันนี้ (ไม่นับซ้ำ)
    // รอบที่ออกส่ง (ใบงานที่กดออกส่งพร้อมกัน = เวลาออกเดียวกัน)
    const rounds: { start_time: string; routes: number; orders: number; delivered: number }[] = [];

    for (const route of routes) {
      const delivered = route.stops.filter((stop) => stop.status === "delivered").length;
      sales = sales + route.sales;
      riderCost = riderCost + route.rider_cost;
      boxes = boxes + route.boxes;
      km = km + route.total_km;
      orderCount = orderCount + route.stops.length;
      deliveredTotal = deliveredTotal + delivered;
      if (route.rider && !riderIds.includes(route.rider.id)) {
        riderIds.push(route.rider.id);
      }

      // เวลาส่งเสร็จของทั้งวัน = จุดสุดท้ายของรอบที่ส่งเสร็จช้าที่สุด
      const startTime = route.start_time as string;
      const doneAt = minutesBetween("00:00", startTime) + route.finish_minutes;
      if (doneAt > finishAt) {
        finishAt = doneAt;
        finishTime = route.finish_time;
        finishMinutes = route.finish_minutes;
      }

      // นับรวมเข้ารอบของเวลาออกส่งนี้
      let round = rounds.find((item) => item.start_time === startTime);
      if (!round) {
        round = { start_time: startTime, routes: 0, orders: 0, delivered: 0 };
        rounds.push(round);
      }
      round.routes = round.routes + 1;
      round.orders = round.orders + route.stops.length;
      round.delivered = round.delivered + delivered;
    }
    rounds.sort((a, b) => a.start_time.localeCompare(b.start_time));

    const foodCost = boxes * BOX_COST;
    const lastRound = rounds[rounds.length - 1];
    res.json({
      date: date,
      riders: riderIds.length,
      riders_available: riders.length,
      riders_free: free.length, // ไรเดอร์ที่ว่าง รับรอบใหม่ได้
      orders: orderCount,
      delivered: deliveredTotal, // ส่งถึงแล้วกี่ออเดอร์
      waiting: waiting.length,
      outside: outside.map((order) => order.id), // ออเดอร์ที่อยู่นอกเขตส่ง 3 กม. (ต้องแก้จุดส่งหรือยกเลิก)
      boxes: boxes,
      total_km: Math.round(km * 100) / 100,
      sales: sales,
      food_cost: foodCost,
      rider_cost: Math.round(riderCost * 100) / 100,
      profit: Math.round((sales - foodCost - riderCost) * 100) / 100,
      start_time: lastRound ? lastRound.start_time : null, // เวลาออกส่งรอบล่าสุด
      finish_time: finishTime,
      finish_minutes: finishMinutes,
      late_orders: routes.filter((route) => route.late_orders > 0).length,
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
      return res.status(400).json({ error: "ไรเดอร์เริ่มส่งใบงานนี้แล้ว เปลี่ยนคนส่งไม่ได้" });
    }
    const riders = await activeRiders();
    if (!riders.some((rider) => rider.id === riderId)) {
      return res.status(400).json({ error: "ไม่พบไรเดอร์คนนี้ หรือไรเดอร์ถูกปิดใช้งาน" });
    }
    // ใบงานอื่นของไรเดอร์คนใหม่ในวันเดียวกันที่ยังส่งไม่ครบ (ไรเดอร์ไม่ว่าง)
    const [busyRows] = await conn.query(
      "SELECT DISTINCT routes.id FROM routes JOIN route_stops ON route_stops.route_id = routes.id" +
        " JOIN orders ON orders.id = route_stops.order_id" +
        " WHERE routes.delivery_date = ? AND routes.rider_id = ? AND routes.id <> ? AND orders.status = 'delivering'",
      [route.delivery_date, riderId, route.id]
    );
    const busyRoutes = busyRows as any[];
    for (const busy of busyRoutes) {
      if ((await deliveredCount(busy.id)) > 0) {
        return res.status(400).json({ error: "ไรเดอร์คนนี้กำลังออกส่งอยู่ ให้เลือกคนอื่น" });
      }
    }
    // สลับ: ใบงานที่ไรเดอร์คนใหม่ถืออยู่ (ยังไม่เริ่มส่ง) ได้ไรเดอร์คนเก่าไปแทน
    for (const busy of busyRoutes) {
      await conn.query("UPDATE routes SET rider_id = ? WHERE id = ?", [route.rider_id, busy.id]);
    }
    const [result] = await conn.query("UPDATE routes SET rider_id = ? WHERE id = ?", [riderId, route.id]);
    const updateResult = result as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
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
      return res.status(400).json({ error: "ไรเดอร์ส่งของถึงลูกค้าไปแล้ว ยกเลิกใบงานนี้ไม่ได้" });
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
