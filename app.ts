// สร้าง Express App และผูก Controller เข้ากับ path
import express from "express";
import cors from "cors";
import { router as index } from "./controller/index";
import { router as customer } from "./controller/customer";
import { router as order } from "./controller/order";
import { router as auth } from "./controller/auth";
import { router as rider } from "./controller/rider";
import { router as route } from "./controller/route";
import { router as job } from "./controller/job";
import { jwtAuthen, jwtError, ownerOnly } from "./jwtauth";
import { limiter } from "./limiter";

export const app = express();

// ไม่บอกว่าเซิร์ฟเวอร์ใช้ Express (ลดข้อมูลที่ผู้โจมตีใช้หาช่องโหว่)
app.disable("x-powered-by");
// รันหลัง proxy ของ Vercel ให้ req.ip เป็น IP จริงของผู้ใช้ (ใช้นับจำนวนครั้งใน limiter)
app.set("trust proxy", 1);

// CORS แบบ whitelist อนุญาตหน้าเว็บ Angular ในเครื่อง
const allowedOrigins = [
  "http://localhost:4200",
  "http://127.0.0.1:4200",
  "https://adv-web-frontend.vercel.app", // หน้าเว็บ frontend ที่ deploy บน Vercel
];
app.use(
  cors({
    origin: function (origin, callback) {
      // ไม่มี origin = ไม่ได้เรียกจากเบราว์เซอร์ (เรียกตรงจากโปรแกรมอื่น) ให้ผ่านได้
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
// login ได้ไม่เกิน 20 ครั้ง / 15 นาที ต่อเครื่อง (กันเดารหัสผ่าน)
app.use("/auth/login", limiter(20, 15));
app.use("/auth", auth);
// เปิดใบงานด้วยเลขใบงาน ไม่เกิน 60 ครั้ง / 15 นาที ต่อเครื่อง (กันเดาเลขใบงาน)
app.use("/jobs", limiter(60, 15), job);
// ส่วนของเจ้าของร้าน (ไรเดอร์เรียกได้ 403)
app.use("/customers", ownerOnly, customer);
app.use("/orders", ownerOnly, order);
app.use("/riders", ownerOnly, rider);
app.use("/routes", ownerOnly, route);

// ดัก Error ที่เหลือทั้งหมด ตอบเป็น JSON สั้นๆ ไม่ส่งรายละเอียดโค้ด (stack trace) ออกไป
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ error: "รูปแบบ JSON ไม่ถูกต้อง" });
    return;
  }
  if (err.type === "entity.too.large") {
    res.status(413).json({ error: "ข้อมูลที่ส่งมาใหญ่เกินไป" });
    return;
  }
  if (err.message === "Not allowed by CORS") {
    res.status(403).json({ error: "Not allowed by CORS" });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
});

// ให้ Vercel นำ app ไปรัน (Vercel หาไฟล์ app.ts แล้วใช้ export default)
export default app;
