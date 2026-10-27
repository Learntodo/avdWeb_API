// จุดเริ่มรันเซิร์ฟเวอร์
import http from "http";
import { app } from "./app";

// ใช้พอร์ตจากตัวแปร env ชื่อ PORT ถ้าไม่มี ใช้ 3000 (รันในเครื่อง)
const port = process.env.PORT || 3000;
const server = http.createServer(app);

server
  .listen(port, () => {
    console.log(`Server is started on port ${port}`);
  })
  .on("error", (error) => {
    console.error(error);
  });
