// ระบบคิดเส้นทางส่งข้าวกล่อง: แบ่งออเดอร์ให้ไรเดอร์ (คนละไม่เกิน 3 ออเดอร์) และเรียงลำดับจุดส่ง
// เป้าหมาย: ค่าไรเดอร์รวมน้อยที่สุด (= ร้านกำไรมากที่สุด) และทุกจุดต้องส่งถึงไม่เกิน 12:30 น.
import { RouteResult, StopResult, PlanResult } from "./model/route";

// ---------- ค่าคงที่ตามโจทย์ ----------
export const SHOP = { lat: 16.246, lng: 103.25 }; // พิกัดร้าน (แถวมหาวิทยาลัยมหาสารคาม)
export const MAX_ORDERS = 3; // ไรเดอร์ 1 คนรับได้ไม่เกิน 3 ออเดอร์
export const SPEED_KMH = 30; // ไรเดอร์ขับประมาณ 30 กม./ชม.
export const START_MIN = 11 * 60 + 30; // ออกจากร้าน 11:30 น. (เก็บเป็นนาทีนับจากเที่ยงคืน)
export const DEADLINE_MIN = 12 * 60 + 30; // ต้องถึงลูกค้าไม่เกิน 12:30 น.
export const RIDER_BASE = 15; // ค่าเรียกไรเดอร์ 15 บาทต่อครั้ง
export const RIDER_PER_KM_BOX = 2; // ค่าส่ง 2 บาท ต่อ กม. ต่อ กล่อง
export const BOX_COST = 40; // ต้นทุนข้าวกล่องละ 40 บาท

// ---------- ค่าที่สมมติเพิ่ม (แก้ได้) ----------
export const ROAD_FACTOR = 1.3; // ใช้เมื่อโหลดระยะถนนจริงไม่ได้: ถนนอ้อมกว่าเส้นตรง จึงคูณระยะเส้นตรงเพิ่ม 30%
export const STOP_MINUTES = 5; // เวลาจอดส่งของแต่ละจุด (นาที)
// ระยะทางที่ใช้คิดค่าส่ง = จากร้านไปจุดส่งจุดสุดท้าย (ไม่นับขากลับร้าน)

// ข้อมูลออเดอร์ที่ใช้คำนวณ (มาจากตาราง orders JOIN customers)
export interface PlanOrder {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  delivery_address: string;
  delivery_latitude: number;
  delivery_longitude: number;
  quantity: number;
  total_price: number;
}

// ---------- ระยะทางตามถนนจริง ----------
// ใช้บริการ OSRM (แผนที่ถนนจาก OpenStreetMap ฟรี) คิดระยะขับรถจริงระหว่างทุกคู่จุดในครั้งเดียว
export const ROAD_API = "https://router.project-osrm.org";
// ระยะถนนจริงที่โหลดมาแล้ว (กม.) เก็บตามคู่พิกัด เช่น "16.246000,103.250000>16.250000,103.260000"
let roadKm = new Map<string, number>();

function pointKey(lat: number, lng: number): string {
  return Number(lat).toFixed(6) + "," + Number(lng).toFixed(6);
}

// โหลดระยะถนนจริงระหว่างทุกคู่จุด (ร้าน + จุดส่ง) จาก OSRM ด้วยคำขอเดียว (table service)
// สำเร็จคืนค่า true, เชื่อมต่อไม่ได้ / ช้าเกิน 6 วินาที คืนค่า false แล้วระบบใช้ระยะโดยประมาณแทน
export async function loadRoadDistances(points: { lat: number; lng: number }[]): Promise<boolean> {
  // ตัดจุดซ้ำ (ลูกค้าคนเดียวกันสั่งหลายออเดอร์) และใส่ร้านเป็นจุดแรก
  const keys: string[] = [pointKey(SHOP.lat, SHOP.lng)];
  const list = [SHOP];
  for (const p of points) {
    const key = pointKey(p.lat, p.lng);
    if (!keys.includes(key)) {
      keys.push(key);
      list.push(p);
    }
  }
  // เคยโหลดครบทุกคู่แล้ว (เช่น กดคำนวณใหม่ / ยืนยันแผน) ไม่ต้องโหลดซ้ำ
  if (keys.every((a) => keys.every((b) => roadKm.has(a + ">" + b)))) return true;
  if (list.length > 100) return false; // OSRM รับได้ไม่เกิน 100 จุดต่อครั้ง
  try {
    const coords = list.map((p) => `${Number(p.lng)},${Number(p.lat)}`).join(";");
    const response = await fetch(`${ROAD_API}/table/v1/driving/${coords}?annotations=distance`, {
      signal: AbortSignal.timeout(6000),
    });
    const data: any = await response.json();
    if (!response.ok || data.code !== "Ok") return false;
    if (roadKm.size > 50000) roadKm = new Map<string, number>(); // ไม่ให้หน่วยความจำเต็ม
    for (let i = 0; i < keys.length; i++) {
      for (let j = 0; j < keys.length; j++) {
        const meters = data.distances[i][j];
        // ไปไม่ถึงทางถนน (null) ไม่เก็บ ให้ใช้ระยะโดยประมาณแทน
        if (typeof meters === "number") roadKm.set(keys[i] + ">" + keys[j], meters / 1000);
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

// ระยะทาง (กม.) จากจุดที่ 1 ไปจุดที่ 2
// มีระยะถนนจริงจาก OSRM ใช้ค่านั้น ไม่มีใช้สูตร Haversine (ระยะเส้นตรงบนผิวโลก) x ROAD_FACTOR
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const road = roadKm.get(pointKey(lat1, lng1) + ">" + pointKey(lat2, lng2));
  if (road !== undefined) return road;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a)) * ROAD_FACTOR;
}

// แปลงนาทีเป็นเวลา เช่น 702 -> "11:42"
export function toTime(minutes: number): string {
  const total = Math.ceil(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// ปัดทศนิยม 2 ตำแหน่ง
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// คำนวณรายละเอียดของ 1 เที่ยว ตามลำดับออเดอร์ที่ให้มา: ระยะทาง เวลาถึงแต่ละจุด ค่าไรเดอร์ กำไร
export function measureRoute(orders: PlanOrder[]): RouteResult {
  let lat = SHOP.lat;
  let lng = SHOP.lng;
  let km = 0;
  let time = START_MIN;
  let boxes = 0;
  let sales = 0;
  let late = 0;
  const stops: StopResult[] = [];

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i] as PlanOrder;
    const legKm = distanceKm(lat, lng, o.delivery_latitude, o.delivery_longitude);
    km = km + legKm;
    time = time + (legKm / SPEED_KMH) * 60; // เวลาขับ (นาที) = ระยะ / ความเร็ว x 60
    if (time > DEADLINE_MIN) late = late + 1;
    stops.push({
      seq: i + 1,
      order_id: o.id,
      first_name: o.first_name,
      last_name: o.last_name,
      phone: o.phone,
      delivery_address: o.delivery_address,
      latitude: o.delivery_latitude,
      longitude: o.delivery_longitude,
      quantity: o.quantity,
      distance_km: round2(legKm),
      eta: toTime(time),
    });
    time = time + STOP_MINUTES; // จอดส่งของก่อนไปจุดถัดไป
    boxes = boxes + o.quantity;
    sales = sales + Number(o.total_price);
    lat = o.delivery_latitude;
    lng = o.delivery_longitude;
  }

  // ค่าไรเดอร์ = 15 + 2 x ระยะทางทั้งรอบ x จำนวนกล่องที่ถือไป
  const riderCost = RIDER_BASE + RIDER_PER_KM_BOX * km * boxes;
  return {
    route_no: 0,
    order_ids: orders.map((o) => o.id),
    stops: stops,
    total_km: round2(km),
    boxes: boxes,
    sales: round2(sales),
    food_cost: boxes * BOX_COST,
    rider_cost: round2(riderCost),
    profit: round2(sales - boxes * BOX_COST - riderCost),
    finish_time: toTime(time - STOP_MINUTES),
    late_orders: late,
  };
}

// ทุกลำดับที่เป็นไปได้ของออเดอร์ (ไม่เกิน 3 ออเดอร์ จึงมีอย่างมาก 6 แบบ)
function permutations(list: PlanOrder[]): PlanOrder[][] {
  if (list.length <= 1) return [list];
  const result: PlanOrder[][] = [];
  for (let i = 0; i < list.length; i++) {
    const rest = list.filter((_, j) => j !== i);
    for (const p of permutations(rest)) {
      result.push([list[i] as PlanOrder, ...p]);
    }
  }
  return result;
}

// เก็บผลของกลุ่มที่เคยคำนวณแล้ว (กลุ่มเดิมไม่ต้องคิดซ้ำ ทำให้คำนวณเร็วขึ้นมาก)
let memo = new Map<string, RouteResult>();

// หาลำดับการส่งที่ดีที่สุดของ 1 เที่ยว: ลองทุกลำดับ เลือกที่ไม่เลท และค่าไรเดอร์น้อยสุด
// (ค่าไรเดอร์คิดตามระยะทั้งรอบ ลำดับที่ระยะสั้นสุดจึงถูกสุด เช่น จุดใกล้ร้านส่งก่อน)
function bestRoute(orders: PlanOrder[]): RouteResult {
  const key = orders
    .map((o) => o.id)
    .sort((a, b) => a - b)
    .join(",");
  const saved = memo.get(key);
  if (saved) return saved;
  let best: RouteResult | null = null;
  for (const p of permutations(orders)) {
    const route = measureRoute(p);
    if (
      best === null ||
      route.late_orders < best.late_orders ||
      (route.late_orders === best.late_orders && route.rider_cost < best.rider_cost)
    ) {
      best = route;
    }
  }
  memo.set(key, best as RouteResult);
  return best as RouteResult;
}

// ค่าไรเดอร์ของกลุ่ม (ถ้ามีจุดเลย คิดแพงมากๆ เพื่อไม่ให้เลือกแบบนี้)
function groupCost(route: RouteResult): number {
  return route.rider_cost + route.late_orders * 100000;
}

// จัดเส้นทาง 1 แบบ
// 1) เริ่มจากให้ไรเดอร์ 1 คนต่อ 1 ออเดอร์
// 2) รวมกลุ่มที่อยู่ใกล้กันเข้าด้วยกัน ถ้ารวมแล้วค่าไรเดอร์รวมลดลง (วิธี Savings) จนรวมต่อไม่ได้
// 3) ลองย้าย / สลับออเดอร์ระหว่างไรเดอร์ ถ้าค่าใช้จ่ายลดลงก็เปลี่ยน
// random = true จะสุ่มเลือกการรวมจาก 3 อันดับแรก เพื่อให้ได้เส้นทางแบบอื่นมาเสนอ
function buildRoutes(orders: PlanOrder[], random: boolean): RouteResult[] {
  let routes: RouteResult[] = orders.map((o) => bestRoute([o]));

  // ขั้นที่ 2 รวมกลุ่ม
  while (true) {
    const merges: { i: number; j: number; saving: number; route: RouteResult }[] = [];
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const a = routes[i] as RouteResult;
        const b = routes[j] as RouteResult;
        if (a.order_ids.length + b.order_ids.length > MAX_ORDERS) continue;
        const merged = bestRoute(ordersOf(orders, [...a.order_ids, ...b.order_ids]));
        if (merged.late_orders > 0) continue;
        const saving = groupCost(a) + groupCost(b) - groupCost(merged);
        if (saving > 0.01) merges.push({ i: i, j: j, saving: saving, route: merged });
      }
    }
    if (merges.length === 0) break;
    merges.sort((x, y) => y.saving - x.saving);
    const pick = random ? Math.floor(Math.random() * Math.min(3, merges.length)) : 0;
    const m = merges[pick] as (typeof merges)[number];
    routes = routes.filter((_, k) => k !== m.i && k !== m.j);
    routes.push(m.route);
  }

  // ขั้นที่ 3 ปรับปรุงด้วยการย้าย / สลับออเดอร์
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < routes.length && !improved; i++) {
      for (let j = 0; j < routes.length && !improved; j++) {
        if (i === j) continue;
        const a = routes[i] as RouteResult;
        const b = routes[j] as RouteResult;
        const before = groupCost(a) + groupCost(b);
        for (const idA of a.order_ids) {
          // ย้ายออเดอร์ idA จากเที่ยว a ไปเที่ยว b
          if (b.order_ids.length < MAX_ORDERS) {
            const restA = a.order_ids.filter((id) => id !== idA);
            const newB = bestRoute(ordersOf(orders, [...b.order_ids, idA]));
            const newA = restA.length > 0 ? bestRoute(ordersOf(orders, restA)) : null;
            const after = groupCost(newB) + (newA ? groupCost(newA) : 0);
            if (after < before - 0.01) {
              routes = routes.filter((_, k) => k !== i && k !== j);
              routes.push(newB);
              if (newA) routes.push(newA);
              improved = true;
              break;
            }
          }
          // สลับออเดอร์ idA กับออเดอร์ idB ของเที่ยว b
          for (const idB of b.order_ids) {
            const newA = bestRoute(ordersOf(orders, [...a.order_ids.filter((id) => id !== idA), idB]));
            const newB = bestRoute(ordersOf(orders, [...b.order_ids.filter((id) => id !== idB), idA]));
            if (groupCost(newA) + groupCost(newB) < before - 0.01) {
              routes = routes.filter((_, k) => k !== i && k !== j);
              routes.push(newA, newB);
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
      }
    }
  }
  return routes;
}

// ดึงข้อมูลออเดอร์ตามรหัสที่ให้มา (เรียงตามรหัสที่ให้)
export function ordersOf(orders: PlanOrder[], ids: number[]): PlanOrder[] {
  const result: PlanOrder[] = [];
  for (const id of ids) {
    const order = orders.find((o) => o.id === id);
    if (order) result.push(order);
  }
  return result;
}

// รวมเที่ยวทั้งหมดเป็น 1 แผน พร้อมสรุปยอดขาย ต้นทุน ค่าไรเดอร์ กำไร และเวลาส่งเสร็จ
export function summarize(routes: RouteResult[]): PlanResult {
  // เรียงเที่ยวตามมุมรอบร้าน (ทิศ) ให้ไรเดอร์คนที่ 1, 2, 3 ... ไล่ตามทิศ ดูบนแผนที่ง่าย
  const angle = (r: RouteResult) => {
    const first = r.stops[0] as StopResult;
    return Math.atan2(first.latitude - SHOP.lat, first.longitude - SHOP.lng);
  };
  // คัดลอกเที่ยวก่อน (ใช้ร่วมกันหลายแผน) แล้วเรียง
  const sorted = routes.map((r) => ({ ...r })).sort((a, b) => angle(a) - angle(b));
  let km = 0;
  let boxes = 0;
  let sales = 0;
  let riderCost = 0;
  let late = 0;
  let finish = "00:00";
  let orderCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i] as RouteResult;
    r.route_no = i + 1;
    km = km + r.total_km;
    boxes = boxes + r.boxes;
    sales = sales + r.sales;
    riderCost = riderCost + r.rider_cost;
    late = late + r.late_orders;
    orderCount = orderCount + r.order_ids.length;
    if (r.finish_time > finish) finish = r.finish_time;
  }
  return {
    riders: sorted.length,
    orders: orderCount,
    boxes: boxes,
    total_km: round2(km),
    sales: round2(sales),
    food_cost: boxes * BOX_COST,
    rider_cost: round2(riderCost),
    profit: round2(sales - boxes * BOX_COST - riderCost),
    finish_time: finish,
    late_orders: late,
    routes: sorted,
  };
}

// เสนอแผนเส้นทาง 3 แบบ (ค่าใช้จ่ายน้อยสุดก่อน)
// round = ครั้งที่กด "คำนวณใหม่" (0 = ครั้งแรก) ครั้งถัดไปจะเสนอแผนอันดับถัดไปที่ต่างจากเดิม
export function makePlans(orders: PlanOrder[], round: number): PlanResult[] {
  memo = new Map<string, RouteResult>();
  const found: PlanResult[] = [];
  const seen: string[] = [];
  for (let i = 0; i < 80; i++) {
    const plan = summarize(buildRoutes(orders, i > 0)); // รอบแรกไม่สุ่ม รอบต่อไปสุ่ม
    // แผนที่แบ่งกลุ่มเหมือนกันนับเป็นแผนเดียว
    const key = plan.routes
      .map((r) => [...r.order_ids].sort((a, b) => a - b).join(","))
      .sort()
      .join("|");
    if (!seen.includes(key)) {
      seen.push(key);
      found.push(plan);
    }
  }
  found.sort((a, b) => a.late_orders - b.late_orders || a.rider_cost - b.rider_cost);

  // เลือก 3 แผนตามรอบที่กด (วนกลับไปเริ่มใหม่ถ้าแผนหมด)
  const result: PlanResult[] = [];
  const count = Math.min(3, found.length);
  for (let i = 0; i < count; i++) {
    result.push(found[(round * 3 + i) % found.length] as PlanResult);
  }
  return result;
}
