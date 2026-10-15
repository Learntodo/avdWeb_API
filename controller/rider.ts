// API จัดการข้อมูลไรเดอร์ /riders (เฉพาะเจ้าของร้าน)
// ไรเดอร์เก็บในตาราง users ที่ role = 'rider' และใช้เบอร์โทร + รหัสผ่าน login เข้าดูใบงาน
import express from "express";
import mysql from "mysql2";
import bcrypt from "bcryptjs";
import { conn } from "../dbconnect";
import { User } from "../model/user";

export const router = express.Router();

// คอลัมน์ที่ส่งกลับไป (ไม่ส่งรหัสผ่าน)
const RIDER_COLUMNS = "id, phone, first_name, last_name, license_plate, is_active, created_at, updated_at";

// แสดงไรเดอร์ทุกคน
router.get("/", async (req, res) => {
  try {
    const [rows] = await conn.query(`SELECT ${RIDER_COLUMNS} FROM users WHERE role = 'rider' ORDER BY id`);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// แสดงไรเดอร์ 1 คน
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await conn.query(`SELECT ${RIDER_COLUMNS} FROM users WHERE role = 'rider' AND id = ?`, [
      req.params.id,
    ]);
    const riders = rows as User[];
    if (riders.length === 0) {
      return res.status(404).json({ error: "Rider not found" });
    }
    res.json(riders[0]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// เพิ่มไรเดอร์
// body: { "first_name": "...", "last_name": "...", "phone": "0812345678", "license_plate": "1กข 1234", "password": "..." }
router.post("/", async (req, res) => {
  try {
    const rider = req.body || {};
    if (String(rider.password || "").length < 6) {
      return res.status(400).json({ error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัว" });
    }
    // เก็บรหัสผ่านแบบเข้ารหัส (bcrypt) ไม่เก็บรหัสจริงในฐานข้อมูล
    const hash = await bcrypt.hash(String(rider.password), 10);
    let sql =
      "INSERT INTO `users`(`phone`, `password`, `role`, `first_name`, `last_name`, `license_plate`) VALUES (?,?,'rider',?,?,?)";
    const [result] = await conn.query(sql, [
      rider.phone,
      hash,
      rider.first_name,
      rider.last_name,
      rider.license_plate || null,
    ]);
    const insertResult = result as any;
    res.status(201).json({
      affected_row: insertResult.affectedRows,
      last_idx: insertResult.insertId,
    });
  } catch (error: any) {
    // เบอร์โทรซ้ำกับคนที่มีอยู่แล้ว (phone เป็น UNIQUE)
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "เบอร์โทรนี้มีในระบบแล้ว" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// แก้ไขข้อมูลไรเดอร์ ส่งมาเฉพาะฟิลด์ที่จะแก้ เช่น { "license_plate": "...", "is_active": 0 }
// ส่ง password มา = ตั้งรหัสผ่านใหม่ให้ไรเดอร์
router.put("/:id", async (req, res) => {
  try {
    let id = +req.params.id;
    let rider = req.body || {};

    // 1. ค้นหาข้อมูลเดิมก่อน
    let sql = mysql.format("SELECT * FROM users WHERE role = 'rider' AND id = ?", [id]);
    let [response] = await conn.query(sql);
    let result = response as User[];
    if (result.length === 0) {
      return res.status(404).json({ error: "Rider not found" });
    }
    let riderOriginal = result[0] as User;

    // 2. นำข้อมูลเดิมมาทับด้วยข้อมูลใหม่ที่ส่งมา
    let updateRider = { ...riderOriginal, ...rider };
    if (rider.password !== undefined && rider.password !== "") {
      if (String(rider.password).length < 6) {
        return res.status(400).json({ error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัว" });
      }
      updateRider.password = await bcrypt.hash(String(rider.password), 10);
    } else {
      updateRider.password = riderOriginal.password;
    }

    // 3. เขียนข้อมูลที่รวมแล้วกลับลงฐานข้อมูล
    sql =
      "UPDATE `users` SET `phone`=?, `password`=?, `first_name`=?, `last_name`=?, `license_plate`=?, `is_active`=? WHERE `id`=?";
    sql = mysql.format(sql, [
      updateRider.phone,
      updateRider.password,
      updateRider.first_name,
      updateRider.last_name,
      updateRider.license_plate || null,
      Number(updateRider.is_active) === 1 ? 1 : 0,
      id,
    ]);
    [response] = await conn.query(sql);
    const updateResult = response as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error: any) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "เบอร์โทรนี้มีในระบบแล้ว" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ลบไรเดอร์
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await conn.query("DELETE FROM users WHERE role = 'rider' AND id = ?", [req.params.id]);
    const deleteResult = result as any;
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ error: "Rider not found" });
    }
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
