# avdWeb_API — HW-5 Web API (ส่งด่วนมื้อเที่ยง)

Web API จัดการลูกค้าและรายการสั่งซื้อตาม HW-5
(Express + TypeScript 5 + mysql2, แยก controller / model / dbconnect, แต่ละ route เป็น `try { query } catch { 500 }`)

## วิธีรัน

1. แก้ไฟล์ `dbconnect.ts` ใส่ host / user / password / database ของฐานข้อมูล (ค่าเดียวกับใน `avdWeb/backend/.env`)
2. สร้างตารางในฐานข้อมูล: เปิดไฟล์ `sql/schema.sql` แล้วรันใน phpMyAdmin / MySQL Workbench (ทำครั้งเดียว)
3. ติดตั้งแพ็กเกจ
   ```shell
   npm install
   ```
4. รันเซิร์ฟเวอร์
   ```shell
   npx ts-node server.ts
   ```
   หรือให้รีสตาร์ตเองเมื่อกดเซฟ
   ```shell
   npx ts-node-dev server.ts
   ```
5. Deploy บน Render
   - Build Command: `npm install && npx tsc`
   - Start Command: `node dist/server.js`

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
3. กดส่งทีละเส้น หรือ Run collection (14 คำขอ เรียงตามลำดับที่ใช้งาน) ลูกค้าที่เพิ่มและรายการจำลองจะถูกลบเองตอนจบ

## โครงสร้างไฟล์

```
server.ts            เปิดเซิร์ฟเวอร์ (http.createServer)
app.ts               Express app, CORS, express.json() และผูก controller
dbconnect.ts         Connection Pool ของ MySQL (createPool)
controller/          index.ts, customer.ts, order.ts
model/               customer.ts, order.ts (interface)
sql/schema.sql       ตาราง customers และ orders
postman/             ชุดทดสอบ Postman
```
