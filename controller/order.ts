// API จัดการรายการสั่งซื้อ /orders (HW-5 ข้อ 3)
import express from "express";
import { conn } from "../dbconnect";
import { Customer } from "../model/customer";
import { Order } from "../model/order";

export const router = express.Router();

// 3.1 จำลองรายการสั่งซื้อ 20-30 รายการ (สุ่มลูกค้าที่มีอยู่ และจำนวน 1-3 กล่อง)
router.post("/simulate", async (req, res) => {
  try {
    const [rows] = await conn.query("SELECT * FROM customers");
    const customers = rows as Customer[];
    const count = 20 + Math.floor(Math.random() * 11);
    let affected = 0;
    for (let i = 0; i < count; i++) {
      const customer = customers[Math.floor(Math.random() * customers.length)] as Customer;
      const quantity = 1 + Math.floor(Math.random() * 3);
      let sql =
        "INSERT INTO `orders`(`customer_id`, `quantity`, `delivery_address`, `delivery_latitude`, `delivery_longitude`, `delivery_date`, `is_simulated`) VALUES (?,?,?,?,?,CURDATE(),1)";
      const [result] = await conn.query(sql, [
        customer.id,
        quantity,
        customer.address,
        customer.latitude,
        customer.longitude,
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
// ไม่ส่ง delivery_date (YYYY-MM-DD) มา = ส่งวันนี้, note ไม่บังคับ
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
      "INSERT INTO `orders`(`customer_id`, `quantity`, `delivery_address`, `delivery_latitude`, `delivery_longitude`, `delivery_date`, `note`) VALUES (?,?,?,?,?,COALESCE(?, CURDATE()),?)";
    const [result] = await conn.query(sql, [
      customer.id,
      quantity,
      order.delivery_address ?? customer.address,
      order.delivery_latitude ?? customer.latitude,
      order.delivery_longitude ?? customer.longitude,
      order.delivery_date ?? null,
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
    let sql = "UPDATE orders SET quantity = ? WHERE id = ?";
    let value = req.body.quantity;
    if (req.body.change !== undefined) {
      sql = "UPDATE orders SET quantity = quantity + ? WHERE id = ?";
      value = req.body.change;
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
