// API ใบงานไรเดอร์ /jobs (ไม่ต้อง login ใช้เลขใบงานที่ได้จากร้าน)
import express from "express";
import { savedRoutes } from "./route";
import { SHOP } from "../planner";

export const router = express.Router();

// GET /jobs/{code} เปิดดูใบงานจากเลขใบงาน เช่น /jobs/K7Q2MX9P
// ตอบเฉพาะข้อมูลที่ไรเดอร์ต้องใช้ส่งของ (ไม่มียอดขาย / กำไรของร้าน)
router.get("/:code", async (req, res) => {
  try {
    // ไม่สนตัวพิมพ์เล็กใหญ่ และตัดช่องว่าง / ขีด ที่พิมพ์มาเกิน
    const code = String(req.params.code).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 8) {
      return res.status(404).json({ error: "ไม่พบใบงาน" });
    }
    const routes = await savedRoutes("code", code);
    if (routes.length === 0) {
      return res.status(404).json({ error: "ไม่พบใบงาน" });
    }
    const route = routes[0]!;
    res.json({
      code: route.code,
      delivery_date: route.delivery_date,
      route_no: route.route_no,
      total_km: route.total_km,
      boxes: route.boxes,
      rider_cost: route.rider_cost,
      finish_time: route.finish_time,
      shop: SHOP,
      stops: route.stops,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
