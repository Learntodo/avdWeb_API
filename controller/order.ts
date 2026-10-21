// API จัดการรายการสั่งซื้อ /orders (HW-5 ข้อ 3)
import express from "express";
import mysql from "mysql2";
import { conn } from "../dbconnect";
import { Customer } from "../model/customer";
import { Order } from "../model/order";
import { readDate } from "./route";
import { readCount, SIM_RADIUS_KM } from "./simulate";
import { SHOP } from "../planner";

export const router = express.Router();

// วันที่ส่งแบบ YYYY-MM-DD ตามเวลาไทย (ไม่ส่งมา = วันนี้, ส่งแบบมีเวลาเช่น "2026-10-09T17:00:00.000Z" ก็แปลงให้)
export function thaiDate(value?: string) {
  if (value && value.length === 10) return value;
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

// 3.1 จำลองรายการสั่งซื้อ 20-30 รายการ (สุ่มลูกค้าที่มีอยู่ และจำนวน 1-3 กล่อง)
// สุ่มเฉพาะลูกค้าที่อยู่ในระยะส่ง 3 กม. จากร้าน (นอกระยะ ไรเดอร์ส่งไม่ทัน 12:30 จัดเส้นทางไม่ได้)
// body ไม่บังคับ: { "date": "2026-10-21", "count": 25 } ไม่ส่ง date = วันนี้, ไม่ส่ง count = สุ่ม 20-30
router.post("/simulate", async (req, res) => {
  try {
    const body = req.body || {};
    const date = readDate(body.date);
    if (date === null) {
      return res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
    }
    const count = readCount(body.count, 20 + Math.floor(Math.random() * 11), 50);
    if (count === null) {
      return res.status(400).json({ error: "count ต้องเป็นจำนวนเต็ม 1-50" });
    }
    const [rows] = await conn.query(
      "SELECT *, 6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(latitude - ?) / 2), 2)" +
        " + COS(RADIANS(?)) * COS(RADIANS(latitude)) * POWER(SIN(RADIANS(longitude - ?) / 2), 2))) AS distance_km" +
        " FROM customers HAVING distance_km <= ?",
      [SHOP.lat, SHOP.lat, SHOP.lng, SIM_RADIUS_KM]
    );
    const customers = rows as Customer[];
    if (customers.length === 0) {
      return res.status(400).json({ error: `ไม่มีลูกค้าในระยะ ${SIM_RADIUS_KM} กม. จากร้าน (จำลองลูกค้าก่อน)` });
    }
    let affected = 0;
    for (let i = 0; i < count; i++) {
      const customer = customers[Math.floor(Math.random() * customers.length)] as Customer;
      const quantity = 1 + Math.floor(Math.random() * 3);
      let sql =
        "INSERT INTO `orders`(`customer_id`, `quantity`, `delivery_address`, `delivery_latitude`, `delivery_longitude`, `delivery_date`, `is_simulated`) VALUES (?,?,?,?,?,?,1)";
      const [result] = await conn.query(sql, [
        customer.id,
        quantity,
        customer.address,
        customer.latitude,
        customer.longitude,
        date,
      ]);
      const insertResult = result as any;
      affected += insertResult.affectedRows;
    }
    res.status(201).json({ affected_row: affected });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// เพิ่มรายการสั่งซื้อทีละ 1 รายการ
// body ขั้นต่ำ: { "customer_id": 1, "quantity": 2 }
// ไม่ส่ง delivery_address / delivery_latitude / delivery_longitude มา = ใช้ที่อยู่และพิกัดของลูกค้า
// ไม่ส่ง delivery_date (YYYY-MM-DD) มา = ส่งวันนี้, ไม่ส่ง unit_price มา = 65 บาท, note ไม่บังคับ
router.post("/", async (req, res) => {
  try {
    const order = req.body ?? {};
    const quantity = Number(order.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) {
      return res.status(400).json({ error: "quantity must be 1-3" });
    }
    const [rows] = await conn.query("SELECT * FROM customers WHERE id = ?", [order.customer_id]);
    const customers = rows as Customer[];
    if (customers.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    const customer = customers[0] as Customer;
    let sql =
      "INSERT INTO `orders`(`customer_id`, `quantity`, `unit_price`, `delivery_address`, `delivery_latitude`, `delivery_longitude`, `delivery_date`, `note`) VALUES (?,?,?,?,?,?,?,?)";
    const [result] = await conn.query(sql, [
      customer.id,
      quantity,
      order.unit_price ?? 65,
      order.delivery_address ?? customer.address,
      order.delivery_latitude ?? customer.latitude,
      order.delivery_longitude ?? customer.longitude,
      thaiDate(order.delivery_date),
      order.note ?? null,
    ]);
    const insertResult = result as any;
    res.status(201).json({
      affected_row: insertResult.affectedRows,
      last_idx: insertResult.insertId,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3.1.1, 3.1.2 แสดงรายการสั่งซื้อทั้งหมด พร้อมข้อมูลลูกค้าที่สั่ง และจำนวนกล่อง
router.get("/", async (req, res) => {
  try {
    const [rows] = await conn.query(
      "SELECT orders.*, customers.first_name, customers.last_name, customers.phone FROM orders JOIN customers ON customers.id = orders.customer_id"
    );
    res.json(rows as Order[]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3.1.3 เพิ่ม / ลด / แก้ไข จำนวนกล่อง
// { "quantity": 3 } = แก้เป็น 3 กล่อง, { "change": 1 } = เพิ่ม 1 กล่อง, { "change": -1 } = ลด 1 กล่อง
router.patch("/:id", async (req, res) => {
  try {
    let id = req.params.id;
    const body = req.body || {};
    let sql = "UPDATE orders SET quantity = ? WHERE id = ?";
    let value = body.quantity;
    if (body.change !== undefined) {
      sql = "UPDATE orders SET quantity = quantity + ? WHERE id = ?";
      value = body.change;
    }
    // ต้องเป็นจำนวนเต็มเท่านั้น (จำนวนกล่องเกิน 1-3 ฐานข้อมูลจะไม่ยอมบันทึก)
    if (!Number.isInteger(value)) {
      return res.status(400).json({ error: "quantity / change ต้องเป็นจำนวนเต็ม" });
    }
    const [result] = await conn.query(sql, [value, id]);
    const updateResult = result as any;
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3.2 ล้าง (ลบทั้งหมด) รายการสั่งซื้อที่จำลอง
router.delete("/simulate", async (req, res) => {
  try {
    // ใบงานที่มีออเดอร์จำลองอยู่ ลบทิ้งด้วย (ไม่งั้นใบงานเหลือจุดส่งไม่ครบ) ออเดอร์จริงในใบงานนั้นกลับเป็น "รอส่ง"
    const [rows] = await conn.query(
      "SELECT DISTINCT route_stops.route_id FROM route_stops JOIN orders ON orders.id = route_stops.order_id WHERE orders.is_simulated = 1"
    );
    const routeIds = (rows as any[]).map((r) => r.route_id);
    if (routeIds.length > 0) {
      await conn.query(
        "UPDATE orders SET status = 'pending' WHERE status = 'delivering' AND id IN (SELECT order_id FROM route_stops WHERE route_id IN (?))",
        [routeIds]
      );
      await conn.query("DELETE FROM routes WHERE id IN (?)", [routeIds]);
    }
    const [result] = await conn.query("DELETE FROM orders WHERE is_simulated = 1");
    const deleteResult = result as any;
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3.3 แสดงรายการสั่งซื้อทั้งหมดในระยะ 2 กิโลเมตร จากพิกัดที่กำหนด เช่น /orders/nearby?lat=16.246&lng=103.25
// distance_km = ระยะทาง (กม.) ระหว่างจุดส่งกับพิกัดที่ส่งมา คำนวณด้วยสูตร Haversine
router.get("/nearby", async (req, res) => {
  try {
    const lat = req.query.lat;
    const lng = req.query.lng;
    let sql =
      "SELECT *, 6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(delivery_latitude - ?) / 2), 2)" +
      " + COS(RADIANS(?)) * COS(RADIANS(delivery_latitude)) * POWER(SIN(RADIANS(delivery_longitude - ?) / 2), 2))) AS distance_km" +
      " FROM orders HAVING distance_km <= 2 ORDER BY distance_km";
    const [rows] = await conn.query(sql, [lat, lat, lng]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// แสดงรายการสั่งซื้อ 1 รายการ พร้อมข้อมูลลูกค้าที่สั่ง เช่น /orders/5
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await conn.query(
      "SELECT orders.*, customers.first_name, customers.last_name, customers.phone FROM orders JOIN customers ON customers.id = orders.customer_id WHERE orders.id = ?",
      [req.params.id]
    );
    const orders = rows as Order[];
    if (orders.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(orders[0]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// แก้ไขรายการสั่งซื้อ ส่งมาเฉพาะฟิลด์ที่จะแก้ ฟิลด์ที่ไม่ส่งใช้ค่าเดิม
// แก้ได้: quantity, unit_price, delivery_address, delivery_latitude, delivery_longitude, delivery_date, status, note
// เปลี่ยนลูกค้าที่สั่ง (customer_id) ไม่ได้
router.put("/:id", async (req, res) => {
  try {
    let id = +req.params.id;
    let order: Order = req.body || {};

    // 1. ค้นหาข้อมูลเดิมก่อน
    let sql = mysql.format("SELECT * FROM orders WHERE id = ?", [id]);
    let [response] = await conn.query(sql);
    let result = response as Order[];
    if (result.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    let orderOriginal = result[0] as Order;
    if (order.customer_id !== undefined && order.customer_id != orderOriginal.customer_id) {
      return res.status(400).json({ error: "เปลี่ยนลูกค้าของรายการสั่งซื้อไม่ได้" });
    }

    // 2. นำข้อมูลเดิมมาทับด้วยข้อมูลใหม่ที่ส่งมา
    let updateOrder = { ...orderOriginal, ...order };
    if (updateOrder.quantity < 1 || updateOrder.quantity > 3) {
      return res.status(400).json({ error: "quantity must be 1-3" });
    }
    if (updateOrder.unit_price < 0) {
      return res.status(400).json({ error: "unit_price ต้องไม่ติดลบ" });
    }
    if (!["pending", "delivering", "delivered", "cancelled"].includes(updateOrder.status)) {
      return res.status(400).json({ error: "status ต้องเป็น pending, delivering, delivered หรือ cancelled" });
    }
    updateOrder.delivery_date = thaiDate(updateOrder.delivery_date);

    // 3. เขียนข้อมูลที่รวมแล้วกลับลงฐานข้อมูล
    sql =
      "UPDATE `orders` SET `quantity`=?, `unit_price`=?, `delivery_address`=?, `delivery_latitude`=?, `delivery_longitude`=?, `delivery_date`=?, `status`=?, `note`=? WHERE `id`=?";
    sql = mysql.format(sql, [
      updateOrder.quantity,
      updateOrder.unit_price,
      updateOrder.delivery_address,
      updateOrder.delivery_latitude,
      updateOrder.delivery_longitude,
      updateOrder.delivery_date,
      updateOrder.status,
      updateOrder.note,
      id,
    ]);
    const [records] = await conn.query(sql);
    const updateResult = records as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ลบรายการสั่งซื้อ 1 รายการ เช่น DELETE /orders/5
router.delete("/:id", async (req, res) => {
  try {
    let id = req.params.id;
    const [result] = await conn.query("DELETE FROM orders WHERE id = ?", [id]);
    const deleteResult = result as any;
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
