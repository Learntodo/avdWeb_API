// API เข้าสู่ระบบ /auth (เจ้าของร้าน และไรเดอร์ ใช้เบอร์โทร + รหัสผ่าน)
import express from "express";
import bcrypt from "bcryptjs";
import { conn } from "../dbconnect";
import { generateToken, secret, TokenPayload } from "../jwtauth";
import { User } from "../model/user";

export const router = express.Router();

// hash ปลอมไว้เทียบตอนไม่พบเบอร์ ให้ใช้เวลาตอบเท่ากับกรณีรหัสผิด (กันการเดาว่าเบอร์ไหนมีในระบบจากเวลาที่ตอบ)
const DUMMY_HASH = "$2b$10$BwWjQWTBWT9d9JoyVJIM1enbMSKp9nsmwBlmoycvvtP/b0PPk6Kz2";

// POST /auth/login เข้าสู่ระบบ body: { "phone": "0900000000", "password": "..." }
// สำเร็จได้ตั๋ว (token) ไว้แนบ Header Authorization: Bearer <token> ทุกคำขอ
router.post("/login", async (req, res) => {
  try {
    const body = req.body || {};
    const [rows] = await conn.query("SELECT * FROM users WHERE phone = ?", [String(body.phone)]);
    const users = rows as User[];
    // ไม่พบเบอร์ หรือรหัสผ่านไม่ตรง ตอบข้อความเดียวกัน (ไม่บอกว่าผิดที่เบอร์หรือรหัส)
    const hash = users.length > 0 ? users[0]!.password : DUMMY_HASH;
    const match = await bcrypt.compare(String(body.password), hash);
    if (users.length === 0 || !match) {
      return res.status(401).json({ error: "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง" });
    }
    const user = users[0] as User;
    if (user.is_active !== 1) {
      return res.status(403).json({ error: "บัญชีนี้ถูกปิดใช้งาน" });
    }
    const payload: TokenPayload = { id: user.id, role: user.role };
    res.status(200).json({
      token: generateToken(payload, secret),
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        license_plate: user.license_plate,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /auth/password เปลี่ยนรหัสผ่านของตัวเอง body: { "old_password": "...", "new_password": "..." }
router.put("/password", async (req, res) => {
  try {
    const auth = (req as any).auth as TokenPayload;
    const body = req.body || {};
    if (String(body.new_password || "").length < 6) {
      return res.status(400).json({ error: "รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัว" });
    }
    const [rows] = await conn.query("SELECT * FROM users WHERE id = ?", [auth.id]);
    const users = rows as User[];
    if (users.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    if (!(await bcrypt.compare(String(body.old_password), users[0]!.password))) {
      return res.status(400).json({ error: "รหัสผ่านเดิมไม่ถูกต้อง" });
    }
    const hash = await bcrypt.hash(String(body.new_password), 10);
    const [result] = await conn.query("UPDATE users SET password = ? WHERE id = ?", [hash, auth.id]);
    const updateResult = result as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
