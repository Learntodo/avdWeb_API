// สร้าง Express App และผูก Controller เข้ากับ path
import express from "express";
import cors from "cors";
import { router as index } from "./controller/index";
import { router as customer } from "./controller/customer";
import { router as order } from "./controller/order";
import { router as auth } from "./controller/auth";
import { router as rider } from "./controller/rider";
import { jwtAuthen, jwtError, ownerOnly } from "./jwtauth";

export const app = express();

// CORS แบบ whitelist อนุญาตหน้าเว็บ Angular ในเครื่อง
const allowedOrigins = [
  "http://localhost:4200",
  "http://127.0.0.1:4200",
  "https://adv-web-frontend.vercel.app", // หน้าเว็บ frontend ที่ deploy บน Vercel
];
app.use(
  cors({
    origin: function (origin, callback) {
      // ไม่มี origin = เรียกจาก Postman หรือเบื้องหลัง ให้ผ่านได้
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// แปลงข้อมูลใน Body (ต้องวางก่อน Controller เสมอ)
app.use(express.text());
app.use(express.json());

// ตรวจตั๋ว JWT ทุกคำขอ (ยกเว้น GET / และ POST /auth/login) แล้วดัก error ตั๋วผิด
app.use(jwtAuthen);
app.use(jwtError);

app.use("/", index);
app.use("/auth", auth);
// ส่วนของเจ้าของร้าน (ไรเดอร์เรียกได้ 403)
app.use("/customers", ownerOnly, customer);
app.use("/orders", ownerOnly, order);
app.use("/riders", ownerOnly, rider);

// ให้ Vercel นำ app ไปรัน (Vercel หาไฟล์ app.ts แล้วใช้ export default)
export default app;
