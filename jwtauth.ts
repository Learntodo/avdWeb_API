// ระบบตั๋ว JWT: สร้างตั๋วตอน login และดักตรวจตั๋วทุกคำขอ
import "dotenv/config"; // อ่านค่าจากไฟล์ .env ตอนรันในเครื่อง (บน Vercel ตั้งใน Environment Variables)
import express from "express";
import { expressjwt } from "express-jwt";
import jwt from "jsonwebtoken";

// secret ต้องเป็นค่าสุ่มยาวๆ เก็บในตัวแปร env ชื่อ JWT_SECRET (ไม่เขียนไว้ในโค้ด)
if (!process.env.JWT_SECRET) {
  throw new Error("ยังไม่ได้ตั้งค่า JWT_SECRET");
}
export const secret: string = process.env.JWT_SECRET;

// ข้อมูลที่เก็บในตั๋ว
export interface TokenPayload {
  id: number;
  role: "owner" | "rider";
}

// มิดเดิลแวร์ดักตรวจ JWT ก่อนเข้าใช้ API (ยกเว้นหน้าแรก หน้า login และการเปิดดูใบงานด้วยเลขใบงาน)
export const jwtAuthen = expressjwt({
  secret: secret,
  algorithms: ["HS256"],
  issuer: "CS-MSU",
}).unless({
  path: ["/", "/auth/login", { url: /^\/jobs\/[^/]+$/, methods: ["GET"] }],
});

// สร้างตั๋ว JWT ใหม่ หมดอายุใน 12 ชั่วโมง (ใช้ได้ทั้งวันทำงาน)
export function generateToken(payload: TokenPayload, secretKey: string): string {
  return jwt.sign(payload, secretKey, {
    expiresIn: "12h",
    issuer: "CS-MSU",
  });
}

// ดักรับ Error กรณีไม่มีตั๋ว / ตั๋วปลอม / ตั๋วหมดอายุ (ต้องวางถัดจาก jwtAuthen)
export function jwtError(err: any, req: express.Request, res: express.Response, next: express.NextFunction) {
  if (err.name === "UnauthorizedError") {
    res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
    return;
  }
  next(err);
}

// ให้เข้าได้เฉพาะเจ้าของร้าน ไรเดอร์เรียกจะได้ 403
export function ownerOnly(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = (req as any).auth as TokenPayload;
  if (auth.role !== "owner") {
    res.status(403).json({ error: "ใช้ได้เฉพาะเจ้าของร้าน" });
    return;
  }
  next();
}
