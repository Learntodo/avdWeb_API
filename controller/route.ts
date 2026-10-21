// API จัดเส้นทางส่ง /routes (เฉพาะเจ้าของร้าน)
// คำนวณแผน -> เจ้าของร้านเลือกแผน -> บันทึกเป็นใบงาน (มีเลขใบงานให้ไรเดอร์)
import express from "express";
import crypto from "crypto";
import { conn } from "../dbconnect";
import { thaiDate } from "./order";
import { makePlans, measureRoute, ordersOf, summarize, PlanOrder, MAX_ORDERS, BOX_COST } from "../planner";
import { RouteResult, StopResult } from "../model/route";

export const router = express.Router();

// ตรวจรูปแบบวันที่ YYYY-MM-DD (ไม่ส่งมา = วันนี้ตามเวลาไทย) ผิดรูปแบบคืนค่า null
export function readDate(value: unknown): string | null {
  if (value === undefined || value === "") return thaiDate();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

// ออเดอร์ของวันที่เลือกที่ยังต้องส่ง (รอส่ง / กำลังส่ง) พร้อมชื่อและเบอร์ลูกค้า
async function loadOrders(date: string): Promise<PlanOrder[]> {
  const [rows] = await conn.query(
    "SELECT orders.id, customers.first_name, customers.last_name, customers.phone, orders.delivery_address," +
      " orders.delivery_latitude, orders.delivery_longitude, orders.quantity, orders.total_price" +
      " FROM orders JOIN customers ON customers.id = orders.customer_id" +
      " WHERE orders.delivery_date = ? AND orders.status IN ('pending', 'delivering') ORDER BY orders.id",
    [date]
  );
  return rows as PlanOrder[];
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

// อ่านใบงานที่บันทึกไว้ แล้วจัดเป็นเที่ยว (ใบงาน) พร้อมจุดส่งเรียงตามลำดับ
// ใช้ทั้งหน้าจัดเส้นทาง (ค้นตามวันที่) และหน้าใบงานไรเดอร์ (ค้นตามเลขใบงาน)
export async function savedRoutes(by: "date" | "code", value: string) {
  let sql =
    "SELECT routes.id, routes.code, routes.delivery_date, routes.route_no, routes.total_km, routes.boxes," +
    " routes.rider_cost, routes.finish_time, route_stops.seq, route_stops.order_id, route_stops.distance_km," +
    " route_stops.eta, orders.quantity, orders.total_price, orders.delivery_address," +
    " orders.delivery_latitude, orders.delivery_longitude, customers.first_name, customers.last_name, customers.phone" +
    " FROM routes JOIN route_stops ON route_stops.route_id = routes.id" +
    " JOIN orders ON orders.id = route_stops.order_id JOIN customers ON customers.id = orders.customer_id";
  if (by === "date") {
    sql = sql + " WHERE routes.delivery_date = ? ORDER BY routes.route_no, route_stops.seq";
  } else {
    sql = sql + " WHERE routes.code = ? ORDER BY route_stops.seq";
  }
  const [rows] = await conn.query(sql, [value]);

  const routes: (RouteResult & { id: number; code: string; delivery_date: string })[] = [];
  for (const row of rows as any[]) {
    let route = routes.find((r) => r.id === row.id);
    if (!route) {
      route = {
        id: row.id,
        code: row.code,
        delivery_date: row.delivery_date,
        route_no: row.route_no,
        order_ids: [],
        stops: [],
        total_km: row.total_km,
        boxes: row.boxes,
        sales: 0,
        food_cost: row.boxes * BOX_COST,
        rider_cost: row.rider_cost,
        profit: 0,
        finish_time: row.finish_time,
        late_orders: row.finish_time > "12:30" ? 1 : 0,
      };
      routes.push(route);
    }
    const stop: StopResult = {
      seq: row.seq,
      order_id: row.order_id,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      delivery_address: row.delivery_address,
      latitude: row.delivery_latitude,
      longitude: row.delivery_longitude,
      quantity: row.quantity,
      distance_km: row.distance_km,
      eta: row.eta,
    };
    route.stops.push(stop);
    route.order_ids.push(row.order_id);
    route.sales = route.sales + Number(row.total_price);
    route.profit = Math.round((route.sales - route.food_cost - route.rider_cost) * 100) / 100;
  }
  return routes;
}

// POST /routes/plan คำนวณแผนเส้นทาง (ยังไม่บันทึก) body: { "date": "2026-10-20", "round": 0 }
// ตอบ 3 แผนเรียงจากค่าใช้จ่ายน้อยสุด, round = ครั้งที่กดคำนวณใหม่ (ได้แผนอื่นมาเสนอ)
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
    if (orders.length === 0) {
      return res.status(404).json({ error: "ไม่มีออเดอร์ที่ต้องส่งในวันนี้" });
    }
    res.json({ date: date, plans: makePlans(orders, round) });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /routes ยืนยันแผนแล้วบันทึกเป็นใบงาน (แทนที่ใบงานเดิมของวันนั้น) และเปลี่ยนออเดอร์เป็น "กำลังส่ง"
// body: { "date": "2026-10-20", "routes": [[5, 2], [7], [1, 9, 3]] } (รหัสออเดอร์ของแต่ละเที่ยว เรียงตามลำดับส่ง)
// ระบบคำนวณระยะทาง / ค่าไรเดอร์ ใหม่เองทั้งหมด ไม่เชื่อตัวเลขที่ส่งมา
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

    // ต้องครอบคลุมออเดอร์ที่ต้องส่งของวันนั้นครบทุกรายการพอดี
    const orders = await loadOrders(date);
    if (orders.length !== ids.length || !orders.every((o) => ids.includes(o.id))) {
      return res.status(400).json({ error: "แผนไม่ตรงกับออเดอร์ปัจจุบัน กรุณาคำนวณใหม่" });
    }
    const plan = summarize(list.map((route: number[]) => measureRoute(ordersOf(orders, route))));
    if (plan.late_orders > 0) {
      return res.status(400).json({ error: "แผนนี้มีจุดที่ส่งเกิน 12:30 น." });
    }

    // บันทึกทั้งหมดใน Transaction เดียว (ผิดพลาดตรงไหน ยกเลิกทั้งหมด)
    const db = await conn.getConnection();
    const codes: { route_no: number; code: string }[] = [];
    try {
      await db.beginTransaction();
      await db.query("DELETE FROM routes WHERE delivery_date = ?", [date]);
      for (const route of plan.routes) {
        const code = makeCode();
        const [result] = await db.query(
          "INSERT INTO `routes`(`code`, `delivery_date`, `route_no`, `total_km`, `boxes`, `rider_cost`, `finish_time`) VALUES (?,?,?,?,?,?,?)",
          [code, date, route.route_no, route.total_km, route.boxes, route.rider_cost, route.finish_time]
        );
        const routeId = (result as any).insertId;
        for (const stop of route.stops) {
          await db.query(
            "INSERT INTO `route_stops`(`route_id`, `order_id`, `seq`, `distance_km`, `eta`) VALUES (?,?,?,?,?)",
            [routeId, stop.order_id, stop.seq, stop.distance_km, stop.eta]
          );
        }
        codes.push({ route_no: route.route_no, code: code });
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

// GET /routes?date=2026-10-20 ใบงานที่บันทึกไว้ของวันนั้น พร้อมสรุปยอด
router.get("/", async (req, res) => {
  try {
    const date = readDate(req.query.date);
    if (date === null) {
      return res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
    }
    const routes = await savedRoutes("date", date);
    let sales = 0;
    let riderCost = 0;
    let boxes = 0;
    let km = 0;
    let orders = 0;
    let finish = "00:00";
    for (const r of routes) {
      sales = sales + r.sales;
      riderCost = riderCost + r.rider_cost;
      boxes = boxes + r.boxes;
      km = km + r.total_km;
      orders = orders + r.stops.length;
      if (r.finish_time > finish) finish = r.finish_time;
    }
    res.json({
      date: date,
      riders: routes.length,
      orders: orders,
      boxes: boxes,
      total_km: Math.round(km * 100) / 100,
      sales: sales,
      food_cost: boxes * BOX_COST,
      rider_cost: Math.round(riderCost * 100) / 100,
      profit: Math.round((sales - boxes * BOX_COST - riderCost) * 100) / 100,
      finish_time: finish,
      late_orders: routes.filter((r) => r.late_orders > 0).length,
      routes: routes,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /routes?date=2026-10-20 ยกเลิกใบงานทั้งหมดของวันนั้น ออเดอร์ที่ "กำลังส่ง" กลับเป็น "รอส่ง"
router.delete("/", async (req, res) => {
  try {
    const date = readDate(req.query.date);
    if (date === null) {
      return res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
    }
    await conn.query(
      "UPDATE orders SET status = 'pending' WHERE status = 'delivering' AND id IN" +
        " (SELECT route_stops.order_id FROM route_stops JOIN routes ON routes.id = route_stops.route_id WHERE routes.delivery_date = ?)",
      [date]
    );
    const [result] = await conn.query("DELETE FROM routes WHERE delivery_date = ?", [date]);
    const deleteResult = result as any;
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
