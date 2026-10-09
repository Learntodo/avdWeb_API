// Controller หน้าแรก
import express from "express";

export const router = express.Router();

router.get("/", (req, res) => {
  res.send("HW-5 Web API ส่งด่วนมื้อเที่ยง");
});
