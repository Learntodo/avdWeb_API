# avdWeb_API — HW-5 Web API (ส่งด่วนมื้อเที่ยง)

Web API จัดการลูกค้าและรายการสั่งซื้อตาม HW-5 พร้อมระบบ login (JWT) และข้อมูลไรเดอร์
(Express + TypeScript 5 + mysql2, แยก controller / model / dbconnect, แต่ละ route เป็น `try { query } catch { 500 }`)

## วิธีรัน

1. แก้ไฟล์ `dbconnect.ts` ใส่ host / user / password / database ของฐานข้อมูล (ค่าเดียวกับใน `avdWeb/backend/.env`)
2. สร้างตารางในฐานข้อมูล: รัน `sql/schema.sql` → `sql/users.sql` → `sql/routes.sql` ใน phpMyAdmin / MySQL Workbench / DBeaver (ทำครั้งเดียว)
3. ตั้งค่า `JWT_SECRET` (ค่าสุ่มยาวๆ ใช้เซ็นตั๋ว login) ถ้าไม่ตั้ง เซิร์ฟเวอร์จะไม่ยอมเปิด
   - รันในเครื่อง: สร้างไฟล์ `.env` ใส่บรรทัด `JWT_SECRET=ค่าสุ่ม` (ไฟล์ `.env` ไม่ขึ้น GitHub)
   - บน Vercel: Settings → Environment Variables เพิ่ม `JWT_SECRET`
   - สร้างค่าสุ่มด้วย `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. ติดตั้งแพ็กเกจ
   ```shell
   npm install
   ```
5. รันเซิร์ฟเวอร์
   ```shell
   npx ts-node server.ts
   ```
   หรือให้รีสตาร์ตเองเมื่อกดเซฟ
   ```shell
   npx ts-node-dev server.ts
   ```
6. Deploy บน Vercel: push ขึ้น branch `main` แล้ว Vercel build ให้เอง (ใช้ `export default app` ใน `app.ts`)

## ระบบ login (JWT)

- ทุกเส้นต้องแนบ Header `Authorization: Bearer <token>` ยกเว้น `GET /`, `POST /auth/login` และ `GET /jobs/{code}` ไม่มีตั๋ว / ตั๋วปลอม / หมดอายุ ได้ `401`
- `/customers`, `/orders`, `/riders` ใช้ได้เฉพาะเจ้าของร้าน ไรเดอร์เรียกได้ `403`
- ทุกคน login ด้วยเบอร์โทร + รหัสผ่าน เจ้าของร้านเริ่มต้นคือเบอร์ `0900000000` (รหัสผ่านแจ้งแยก) ตั๋วอายุ 12 ชม.
- รหัสผ่านเก็บแบบเข้ารหัสด้วย bcrypt ไม่มีรหัสจริงในฐานข้อมูล

| Method | Path | หน้าที่ |
|---|---|---|
| POST | /auth/login | `{ "phone": "0900000000", "password": "..." }` → `200 { token, user }`, ผิด `401`, บัญชีถูกปิด `403` |
| PUT | /auth/password | เปลี่ยนรหัสผ่านตัวเอง `{ "old_password": "...", "new_password": "..." }` (อย่างน้อย 6 ตัว) |
| GET | /riders | แสดงไรเดอร์ทุกคน |
| GET | /riders/{id} | แสดงไรเดอร์ 1 คน |
| POST | /riders | เพิ่มไรเดอร์ `{ "first_name", "last_name", "phone", "license_plate", "password" }` (เบอร์ซ้ำ `409`) |
| PUT | /riders/{id} | แก้ไขไรเดอร์ ส่งเฉพาะฟิลด์ที่จะแก้ เช่น `{ "is_active": 0 }` ส่ง `password` = ตั้งรหัสใหม่ |
| DELETE | /riders/{id} | ลบไรเดอร์ |

## จัดเส้นทางส่ง และใบงานไรเดอร์

เงื่อนไขตามโจทย์: ออกจากร้าน 11:30 ต้องถึงไม่เกิน 12:30, ไรเดอร์คนละไม่เกิน 3 ออเดอร์, ขับ 30 กม./ชม.,
ค่าไรเดอร์ = 15 + 2 × กม.ทั้งรอบ × จำนวนกล่อง, ขายกล่องละ 65 ต้นทุน 40 (ค่าคงที่อยู่ใน `planner.ts`)
ค่าที่สมมติเพิ่ม: ระยะถนน = ระยะเส้นตรง (Haversine) × 1.3, จอดส่งจุดละ 5 นาที, ค่าส่งไม่นับขากลับร้าน

วิธีคิด (`planner.ts`): เริ่มให้ไรเดอร์ 1 คนต่อ 1 ออเดอร์ → รวมกลุ่มที่อยู่ใกล้กันถ้าค่าไรเดอร์รวมลดลง (Savings)
→ ลองย้าย/สลับออเดอร์ระหว่างไรเดอร์ → ในแต่ละกลุ่มลองทุกลำดับ (ไม่เกิน 6 แบบ) เลือกระยะสั้นสุดที่ไม่เลท
ทำซ้ำแบบสุ่ม 80 รอบ แล้วเสนอ 3 แผนที่ค่าใช้จ่ายน้อยสุด

| Method | Path | หน้าที่ |
|---|---|---|
| POST | /routes/plan | คำนวณแผน 3 แบบ (ยังไม่บันทึก) `{ "date": "2026-10-20", "round": 0 }` round = ครั้งที่กดคำนวณใหม่ |
| POST | /routes | ยืนยันแผนเป็นใบงาน `{ "date": "2026-10-20", "routes": [[5, 2], [7], [1, 9, 3]] }` ได้เลขใบงานของแต่ละคน ออเดอร์เปลี่ยนเป็น "กำลังส่ง" |
| GET | /routes?date=2026-10-20 | ใบงานที่บันทึกของวันนั้น พร้อมสรุปยอดขาย ค่าไรเดอร์ กำไร |
| DELETE | /routes?date=2026-10-20 | ยกเลิกใบงานของวันนั้น ออเดอร์กลับเป็น "รอส่ง" |
| GET | /jobs/{code} | ใบงานของไรเดอร์จากเลขใบงาน 8 ตัว (ไม่ต้อง login) |

`/routes` ใช้ได้เฉพาะเจ้าของร้าน

## ความปลอดภัย

- SQL ทุกคำสั่งใช้ `?` (ป้องกัน SQL Injection), รหัสผ่านเก็บแบบ bcrypt, JWT บังคับ HS256 + issuer
- login ได้ไม่เกิน 20 ครั้ง / 15 นาที ต่อเครื่อง, เปิดใบงานไม่เกิน 60 ครั้ง / 15 นาที (`limiter.ts`) ตอบ `429`
- เลขใบงานสุ่มด้วย `crypto.randomInt` 8 ตัว (32^8 แบบ) เดาไม่ได้ และใบงานไม่แสดงยอดขาย/กำไรของร้าน
- Error ที่ไม่ได้ดักตอบ JSON สั้นๆ ไม่ส่ง stack trace, ปิด header `X-Powered-By`

## API (เลขข้อตามโจทย์ HW-5)

| ข้อ | Method | Path | หน้าที่ |
|---|---|---|---|
| 2.1 | GET | /customers | แสดงข้อมูลลูกค้าทุกคน |
| 2.1 | POST | /customers | เพิ่มลูกค้า |
| 2.1 | PUT | /customers/{id} | แก้ไขข้อมูลลูกค้า (ส่งครบทุกฟิลด์) |
| 2.1 | DELETE | /customers/{id} | ลบลูกค้า (ลบไม่ได้ถ้ายังมีรายการสั่งซื้อ) |
| 2.2 | GET | /customers/search?name=สม | ค้นหาจากส่วนหนึ่งของชื่อหรือนามสกุล |
| 2.3 | GET | /customers/nearby?lat=16.246&lng=103.25 | ลูกค้าในระยะ 1 กม. จากพิกัด (มี `distance_km`) |
| 3.1.3 | POST | /orders | เพิ่มรายการสั่งซื้อทีละ 1 รายการ `{ "customer_id": 1, "quantity": 2, "unit_price": 65 }` (ที่อยู่/พิกัดใช้ของลูกค้าถ้าไม่ส่งมา, ไม่ส่งราคา = 65) |
| 3.1 | POST | /orders/simulate | จำลองรายการสั่งซื้อ 20–30 รายการ (สุ่มจากลูกค้าในระบบ 1–3 กล่อง) |
| 3.1 | GET | /orders | แสดงรายการสั่งซื้อทั้งหมด พร้อมข้อมูลลูกค้าที่สั่งและจำนวนกล่อง |
| 3.1 | GET | /orders/{id} | แสดงรายการสั่งซื้อ 1 รายการ พร้อมข้อมูลลูกค้าที่สั่ง |
| 3.1.3 | PATCH | /orders/{id} | แก้จำนวนกล่อง `{ "quantity": 2 }` เพิ่ม `{ "change": 1 }` ลด `{ "change": -1 }` |
| 3.1.3 | PUT | /orders/{id} | แก้ไขรายการ ส่งเฉพาะฟิลด์ที่จะแก้ เช่น `{ "unit_price": 70, "note": "ไม่ใส่ผัก" }` (เปลี่ยน `customer_id` ไม่ได้) |
| 3.1.3 | DELETE | /orders/{id} | ลบรายการสั่งซื้อ 1 รายการ |
| 3.2 | DELETE | /orders/simulate | ล้างรายการสั่งซื้อที่จำลองทั้งหมด |
| 3.3 | GET | /orders/nearby?lat=16.246&lng=103.25 | รายการสั่งซื้อในระยะ 2 กม. จากพิกัด (มี `distance_km`) |

ผลลัพธ์:
- เพิ่มสำเร็จ: `201 { "affected_row": 1, "last_idx": 12 }` (`last_idx` คือ id ใหม่)
- แก้/ลบสำเร็จ: `200 { "affected_row": 1 }`
- ไม่พบข้อมูล: `404 { "error": "... not found" }`
- POST / PUT /orders ส่ง quantity ไม่ใช่ 1–3: `400 { "error": "quantity must be 1-3" }`, ไม่พบลูกค้า: `404`
- PUT /orders เปลี่ยน customer_id: `400 { "error": "เปลี่ยนลูกค้าของรายการสั่งซื้อไม่ได้" }`
- ข้อมูลผิด (เช่น เกิน 3 กล่อง, ลบลูกค้าที่ยังมีรายการสั่งซื้อ) ฐานข้อมูลไม่ยอมบันทึก: `500 { "error": "Internal server error" }`

ตัวอย่าง body ของ POST / PUT /customers

```json
{ "first_name": "สมชาย", "last_name": "ใจดี", "phone": "0812345678", "email": null,
  "address": "หอพักริมบึง ห้อง 101", "latitude": 16.246, "longitude": 103.25 }
```

ต้องมีลูกค้าในระบบก่อน ถึงจะจำลองรายการสั่งซื้อได้

## โครงสร้างไฟล์

```
server.ts            เปิดเซิร์ฟเวอร์ (http.createServer)
app.ts               Express app, CORS, express.json(), ตรวจตั๋ว JWT, จำกัดจำนวนครั้ง และผูก controller
dbconnect.ts         Connection Pool ของ MySQL (createPool)
jwtauth.ts           สร้างตั๋ว / ตรวจตั๋ว JWT / ให้เข้าเฉพาะเจ้าของร้าน (ownerOnly)
limiter.ts           จำกัดจำนวนครั้งที่เรียก API ต่อเครื่อง (กันเดารหัสผ่าน / เลขใบงาน)
planner.ts           คำนวณเส้นทางส่ง แบ่งออเดอร์ให้ไรเดอร์ และสรุปค่าใช้จ่าย
controller/          index.ts, customer.ts, order.ts, auth.ts, rider.ts, route.ts, job.ts
model/               customer.ts, order.ts, user.ts, route.ts (interface)
sql/schema.sql       ตาราง customers และ orders
sql/users.sql        ตาราง users (เจ้าของร้าน + ไรเดอร์) และบัญชีเจ้าของร้าน
sql/routes.sql       ตาราง routes (ใบงาน) และ route_stops (จุดส่งในใบงาน)
```
