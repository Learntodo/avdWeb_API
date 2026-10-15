# avdWeb_API — HW-5 Web API (ส่งด่วนมื้อเที่ยง)

Web API จัดการลูกค้าและรายการสั่งซื้อตาม HW-5 พร้อมระบบ login (JWT) และข้อมูลไรเดอร์
(Express + TypeScript 5 + mysql2, แยก controller / model / dbconnect, แต่ละ route เป็น `try { query } catch { 500 }`)

## วิธีรัน

1. แก้ไฟล์ `dbconnect.ts` ใส่ host / user / password / database ของฐานข้อมูล (ค่าเดียวกับใน `avdWeb/backend/.env`)
2. สร้างตารางในฐานข้อมูล: รัน `sql/schema.sql` แล้วต่อด้วย `sql/users.sql` ใน phpMyAdmin / MySQL Workbench / DBeaver (ทำครั้งเดียว)
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
6. Deploy บน Render
   - Build Command: `npm install && npx tsc`
   - Start Command: `node dist/server.js`

## ระบบ login (JWT)

- ทุกเส้นต้องแนบ Header `Authorization: Bearer <token>` ยกเว้น `GET /` และ `POST /auth/login` ไม่มีตั๋ว / ตั๋วปลอม / หมดอายุ ได้ `401`
- `/customers`, `/orders`, `/riders` ใช้ได้เฉพาะเจ้าของร้าน ไรเดอร์เรียกได้ `403`
- ทุกคน login ด้วยเบอร์โทร + รหัสผ่าน เจ้าของร้านเริ่มต้นคือเบอร์ `0900000000` (รหัสผ่านแจ้งแยก) ตั๋วอายุ 12 ชม.
- รหัสผ่านเก็บแบบเข้ารหัสด้วย bcrypt ไม่มีรหัสจริงในฐานข้อมูล

| Method | Path | หน้าที่ |
|---|---|---|
| POST | /auth/login | `{ "phone": "0900000000", "password": "..." }` → `200 { token, user }`, ผิด `401`, บัญชีถูกปิด `403` |
| GET | /auth/me | ข้อมูลของคนที่ login อยู่ |
| PUT | /auth/password | เปลี่ยนรหัสผ่านตัวเอง `{ "old_password": "...", "new_password": "..." }` (อย่างน้อย 6 ตัว) |
| GET | /riders | แสดงไรเดอร์ทุกคน |
| GET | /riders/{id} | แสดงไรเดอร์ 1 คน |
| POST | /riders | เพิ่มไรเดอร์ `{ "first_name", "last_name", "phone", "license_plate", "password" }` (เบอร์ซ้ำ `409`) |
| PUT | /riders/{id} | แก้ไขไรเดอร์ ส่งเฉพาะฟิลด์ที่จะแก้ เช่น `{ "is_active": 0 }` ส่ง `password` = ตั้งรหัสใหม่ |
| DELETE | /riders/{id} | ลบไรเดอร์ |

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

## ทดสอบด้วย Postman

1. เปิด Postman กด Import เลือก `postman/HW5-avdWeb_API.postman_collection.json`
2. ถ้า API ไม่ได้รันที่ `http://localhost:3000` ให้แก้ตัวแปร `baseUrl` ของ collection
3. ใส่รหัสผ่านเจ้าของร้านในตัวแปร `ownerPassword` (คำขอแรก "เจ้าของร้าน login" จะเก็บตั๋วให้ทุกคำขอใช้ต่อ)
4. กดส่งทีละเส้น หรือ Run collection (30 คำขอ เรียงตามลำดับที่ใช้งาน) ลูกค้า ไรเดอร์ที่เพิ่ม และรายการจำลองจะถูกลบเองตอนจบ

## โครงสร้างไฟล์

```
server.ts            เปิดเซิร์ฟเวอร์ (http.createServer)
app.ts               Express app, CORS, express.json(), ตรวจตั๋ว JWT และผูก controller
dbconnect.ts         Connection Pool ของ MySQL (createPool)
jwtauth.ts           สร้างตั๋ว / ตรวจตั๋ว JWT / ให้เข้าเฉพาะเจ้าของร้าน (ownerOnly)
controller/          index.ts, customer.ts, order.ts, auth.ts, rider.ts
model/               customer.ts, order.ts, user.ts (interface)
sql/schema.sql       ตาราง customers และ orders
sql/users.sql        ตาราง users (เจ้าของร้าน + ไรเดอร์) และบัญชีเจ้าของร้าน
postman/             ชุดทดสอบ Postman
```
