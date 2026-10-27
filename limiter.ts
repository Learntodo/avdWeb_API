// จำกัดจำนวนครั้งที่เรียก API ต่อเครื่อง (IP) กันการเดารหัสผ่าน / เดาเลขใบงานแบบรัวๆ
// เก็บตัวนับไว้ในหน่วยความจำของเซิร์ฟเวอร์ (บน Vercel แต่ละเครื่องที่รันนับแยกกัน)
import express from "express";

// max = เรียกได้กี่ครั้ง, minutes = ภายในกี่นาที
export function limiter(max: number, minutes: number) {
  // ตัวนับของแต่ละ IP: count = เรียกไปแล้วกี่ครั้ง, resetAt = เวลาที่เริ่มนับใหม่
  const counters = new Map<string, { count: number; resetAt: number }>();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    // ล้างตัวนับที่หมดเวลาแล้วทิ้ง ไม่ให้หน่วยความจำเต็ม
    if (counters.size > 10000) {
      for (const [oldIp, counter] of counters) {
        if (counter.resetAt < now) counters.delete(oldIp);
      }
    }
    let counter = counters.get(ip);
    // ยังไม่เคยเรียก หรือหมดช่วงเวลาแล้ว เริ่มนับใหม่
    if (!counter || counter.resetAt < now) {
      counter = { count: 0, resetAt: now + minutes * 60 * 1000 };
      counters.set(ip, counter);
    }
    counter.count = counter.count + 1;
    if (counter.count > max) {
      res.status(429).json({ error: `เรียกบ่อยเกินไป ลองใหม่ใน ${minutes} นาที` });
      return;
    }
    next();
  };
}
