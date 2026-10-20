// จำกัดจำนวนครั้งที่เรียก API ต่อเครื่อง (IP) กันการเดารหัสผ่าน / เดาเลขใบงานแบบรัวๆ
// เก็บตัวนับไว้ในหน่วยความจำของเซิร์ฟเวอร์ (บน Vercel แต่ละเครื่องที่รันนับแยกกัน)
import express from "express";

export function limiter(max: number, minutes: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    // ล้างตัวนับที่หมดเวลาแล้วทิ้ง ไม่ให้หน่วยความจำเต็ม
    if (hits.size > 10000) {
      for (const [k, h] of hits) {
        if (h.resetAt < now) hits.delete(k);
      }
    }
    let hit = hits.get(key);
    // ยังไม่เคยเรียก หรือหมดช่วงเวลาแล้ว เริ่มนับใหม่
    if (!hit || hit.resetAt < now) {
      hit = { count: 0, resetAt: now + minutes * 60 * 1000 };
      hits.set(key, hit);
    }
    hit.count = hit.count + 1;
    if (hit.count > max) {
      res.status(429).json({ error: `เรียกบ่อยเกินไป ลองใหม่ใน ${minutes} นาที` });
      return;
    }
    next();
  };
}
