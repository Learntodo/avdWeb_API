// สร้าง Express App และผูก Controller เข้ากับ path
import express from "express";
import cors from "cors";
import { router as index } from "./controller/index";
import { router as customer } from "./controller/customer";
import { router as order } from "./controller/order";

export const app = express();

// CORS แบบ whitelist อนุญาตหน้าเว็บ Angular ในเครื่อง
const allowedOrigins = [
  "http://localhost:4200",
  "http://127.0.0.1:4200",
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

app.use("/", index);
app.use("/customers", customer);
app.use("/orders", order);

// ให้ Vercel นำ app ไปรัน (Vercel หาไฟล์ app.ts แล้วใช้ export default)
export default app;
