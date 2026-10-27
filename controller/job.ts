// API ใบงานไรเดอร์ /jobs
// - GET /jobs/{code} เปิดดูใบงานด้วยเลขใบงาน (ไม่ต้อง login)
// - GET /jobs ใบงานของไรเดอร์ที่ login อยู่ (ไม่ต้องกรอกเลขใบงาน)
// - PUT /jobs/{code}/stops/{orderId} ไรเดอร์กดว่าส่งถึงแล้ว (ต้อง login)
import express from "express";
import { conn } from "../dbconnect";
import { readDate } from "../utils";
import { savedRoutes } from "./route";
import { SHOP } from "../planner";
import { TokenPayload } from "../jwtauth";
import { SavedRoute } from "../model/route";

export const router = express.Router();

// ข้อมูลใบงานที่ไรเดอร์เห็น (ไม่มียอดขาย / กำไรของร้าน)
function jobSheet(route: SavedRoute) {
  return {
    code: route.code,
    delivery_date: route.delivery_date,
    route_no: route.route_no,
    rider: route.rider,
    start_time: route.start_time, // เวลาออกจากร้าน
    total_km: route.total_km,
    boxes: route.boxes,
    rider_cost: route.rider_cost,
    finish_time: route.finish_time,
    shop: SHOP,
    stops: route.stops,
  };
}

// ตัดตัวอักษรแปลกๆ ออกจากเลขใบงาน ไม่สนตัวพิมพ์เล็กใหญ่ (พิมพ์ช่องว่าง / ขีด มาเกินก็ได้)
function cleanCode(value: string): string {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// GET /jobs?date=2026-10-21 ใบงานของไรเดอร์ที่ login อยู่ (ไม่ส่ง date = วันนี้)
router.get("/", async (req, res) => {
  try {
    const auth = (req as any).auth as TokenPayload;
    const date = readDate(req.query.date);
    if (date === null) {
      return res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
    }
    const routes = await savedRoutes("rider", auth.id, date);
    res.json(routes.map((route) => jobSheet(route)));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /jobs/{code} เปิดดูใบงานจากเลขใบงาน เช่น /jobs/K7Q2MX9P
router.get("/:code", async (req, res) => {
  try {
    const code = cleanCode(req.params.code);
    if (code.length !== 8) {
      return res.status(404).json({ error: "ไม่พบใบงาน" });
    }
    const routes = await savedRoutes("code", code);
    if (routes.length === 0) {
      return res.status(404).json({ error: "ไม่พบใบงาน" });
    }
    res.json(jobSheet(routes[0] as SavedRoute));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /jobs/{code}/stops/{orderId} บันทึกว่าส่งถึงลูกค้าแล้ว body: { "delivered": true } (false = กดผิด ย้อนกลับเป็น "กำลังส่ง")
// ทำได้เฉพาะไรเดอร์เจ้าของใบงาน หรือเจ้าของร้าน
router.put("/:code/stops/:orderId", async (req, res) => {
  try {
    const auth = (req as any).auth as TokenPayload;
    const code = cleanCode(req.params.code);
    const [rows] = await conn.query("SELECT id, rider_id FROM routes WHERE code = ?", [code]);
    const route = (rows as any[])[0];
    if (!route) {
      return res.status(404).json({ error: "ไม่พบใบงาน" });
    }
    if (auth.role !== "owner" && route.rider_id !== auth.id) {
      return res.status(403).json({ error: "ใบงานนี้ไม่ใช่ของคุณ" });
    }
    const status = (req.body || {}).delivered === false ? "delivering" : "delivered";
    const [result] = await conn.query(
      "UPDATE orders SET status = ? WHERE id = ? AND status IN ('delivering', 'delivered')" +
        " AND id IN (SELECT order_id FROM route_stops WHERE route_id = ?)",
      [status, req.params.orderId, route.id]
    );
    const updateResult = result as any;
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: "ไม่พบจุดส่งนี้ในใบงาน" });
    }
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
