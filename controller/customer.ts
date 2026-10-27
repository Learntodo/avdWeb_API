// API จัดการลูกค้า /customers (HW-5 ข้อ 2)
import express from "express";
import { conn } from "../dbconnect";
import { Customer } from "../model/customer";
import { outsideArea } from "../planner";

export const router = express.Router();

// 2.1 แสดงข้อมูลลูกค้าทุกคน
router.get("/", async (req, res) => {
  try {
    const [rows] = await conn.query("SELECT * FROM customers");
    res.json(rows as Customer[]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2.1 เพิ่มลูกค้า
router.post("/", async (req, res) => {
  try {
    const customer: Customer = req.body;
    // บ้านลูกค้าต้องอยู่ในเขตส่ง 3 กม. จากร้าน
    const outside = outsideArea(customer.latitude, customer.longitude, "บ้านลูกค้า");
    if (outside !== null) {
      return res.status(400).json({ error: outside });
    }
    const sql =
      "INSERT INTO `customers`(`first_name`, `last_name`, `phone`, `email`, `address`, `latitude`, `longitude`) VALUES (?,?,?,?,?,?,?)";
    const [result] = await conn.query(sql, [
      customer.first_name,
      customer.last_name,
      customer.phone,
      customer.email,
      customer.address,
      customer.latitude,
      customer.longitude,
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

// 2.1 แก้ไขข้อมูลลูกค้า
router.put("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const customer: Customer = req.body;
    // บ้านลูกค้าต้องอยู่ในเขตส่ง 3 กม. จากร้าน
    const outside = outsideArea(customer.latitude, customer.longitude, "บ้านลูกค้า");
    if (outside !== null) {
      return res.status(400).json({ error: outside });
    }
    const sql =
      "UPDATE `customers` SET `first_name`=?, `last_name`=?, `phone`=?, `email`=?, `address`=?, `latitude`=?, `longitude`=? WHERE `id`=?";
    const [result] = await conn.query(sql, [
      customer.first_name,
      customer.last_name,
      customer.phone,
      customer.email,
      customer.address,
      customer.latitude,
      customer.longitude,
      id,
    ]);
    const updateResult = result as any;
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2.1 ลบลูกค้า (ลบไม่ได้ถ้าลูกค้ายังมีรายการสั่งซื้อ)
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    // ลูกค้าที่มีออเดอร์อยู่ ลบไม่ได้ (ฐานข้อมูลไม่ยอมให้ลบ) บอกเหตุผลให้ชัดแทน error 500
    const [orders] = await conn.query("SELECT COUNT(*) AS count FROM orders WHERE customer_id = ?", [id]);
    const orderCount = Number((orders as any[])[0].count);
    if (orderCount > 0) {
      return res.status(400).json({ error: `ลูกค้าคนนี้มีออเดอร์ ${orderCount} รายการ ลบไม่ได้ (ลบออเดอร์ของลูกค้าก่อน)` });
    }
    const [result] = await conn.query("DELETE FROM customers WHERE id = ?", [id]);
    const deleteResult = result as any;
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2.2 ค้นหาลูกค้าจากส่วนหนึ่งของชื่อ / นามสกุล เช่น /customers/search?name=สม
router.get("/search", async (req, res) => {
  try {
    const keyword = "%" + req.query.name + "%"; // % = มีคำนี้อยู่ตรงไหนของชื่อก็ได้
    const [rows] = await conn.query("SELECT * FROM customers WHERE first_name LIKE ? OR last_name LIKE ?", [
      keyword,
      keyword,
    ]);
    res.json(rows as Customer[]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2.3 ค้นลูกค้าทั้งหมดในระยะ 1 กิโลเมตร จากพิกัดที่กำหนด เช่น /customers/nearby?lat=16.246&lng=103.25
// distance_km = ระยะทาง (กม.) ระหว่างบ้านลูกค้ากับพิกัดที่ส่งมา คำนวณด้วยสูตร Haversine
router.get("/nearby", async (req, res) => {
  try {
    const lat = req.query.lat;
    const lng = req.query.lng;
    const sql =
      "SELECT *, 6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(latitude - ?) / 2), 2)" +
      " + COS(RADIANS(?)) * COS(RADIANS(latitude)) * POWER(SIN(RADIANS(longitude - ?) / 2), 2))) AS distance_km" +
      " FROM customers HAVING distance_km <= 1 ORDER BY distance_km";
    const [rows] = await conn.query(sql, [lat, lat, lng]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
