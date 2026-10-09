// จุดเริ่มรันเซิร์ฟเวอร์
import http from "http";
import { app } from "./app";

// ใช้ PORT ตัวพิมพ์ใหญ่ เพราะบริการโฮสติ้ง เช่น Render จะส่งค่ามาในชื่อนี้
const port = process.env.PORT || 3000;
const server = http.createServer(app);

server
  .listen(port, () => {
    console.log(`Server is started on port ${port}`);
  })
  .on("error", (error) => {
    console.error(error);
  });
