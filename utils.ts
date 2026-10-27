// ฟังก์ชันช่วยที่ใช้ร่วมกันหลาย Controller

// วันที่แบบ YYYY-MM-DD ตามเวลาไทย
// ไม่ส่งมา = วันนี้, ส่งแบบมีเวลาเช่น "2026-10-09T17:00:00.000Z" ก็แปลงเป็นวันที่ไทยให้
export function thaiDate(value?: string) {
  if (value && value.length === 10) return value;
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

// อ่านวันที่ที่ส่งมา ต้องเป็นรูปแบบ YYYY-MM-DD (ไม่ส่งมา = วันนี้) ผิดรูปแบบคืนค่า null
export function readDate(value: unknown): string | null {
  if (value === undefined || value === "") return thaiDate();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

// อ่านจำนวนที่ส่งมา (ไม่ส่งมา = ค่าเริ่มต้น fallback) ต้องเป็นจำนวนเต็ม 1 ถึง max ไม่งั้นคืนค่า null
export function readCount(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > max) return null;
  return count;
}

// จำนวนนาทีจากเวลา from ถึงเวลา to เช่น "11:05" -> "11:47" = 42 (ข้ามเที่ยงคืนก็นับถูก)
export function minutesBetween(from: string, to: string): number {
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const oneDay = 24 * 60;
  return (toMinutes(to) - toMinutes(from) + oneDay) % oneDay;
}
