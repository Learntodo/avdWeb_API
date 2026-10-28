// ระบบคิดเส้นทางส่งข้าวกล่อง: แบ่งออเดอร์ให้ไรเดอร์ (คนละไม่เกิน 3 ออเดอร์) และเรียงลำดับจุดส่ง
// เป้าหมาย: ค่าไรเดอร์รวมน้อยที่สุด (= ร้านกำไรมากที่สุด) และทุกจุดต้องส่งถึงภายใน 1 ชั่วโมงหลังกด "ออกส่ง"
//
// คำศัพท์ในไฟล์นี้
// - เที่ยว (route) = งานของไรเดอร์ 1 คน: ออกจากร้าน แล้วไปส่งทีละบ้าน 1-3 บ้าน
// - แผน (plan) = ทุกเที่ยวรวมกัน ครอบคลุมออเดอร์ทั้งหมดที่ต้องส่ง
import { RouteResult, StopResult, PlanResult } from "./model/route";

// ---------- ค่าคงที่ตามโจทย์ ----------
export const SHOP = { lat: 16.246, lng: 103.25 }; // พิกัดร้าน (แถวมหาวิทยาลัยมหาสารคาม)
export const MAX_ORDERS = 3; // ไรเดอร์ 1 คนรับได้ไม่เกิน 3 ออเดอร์
export const SPEED_KMH = 30; // ไรเดอร์ขับประมาณ 30 กม./ชม.
export const MAX_MINUTES = 60; // ต้องถึงลูกค้าทุกจุดภายใน 60 นาที นับจากตอนกด "ออกส่ง"
export const RIDER_BASE = 15; // ค่าเรียกไรเดอร์ 15 บาทต่อครั้ง
export const RIDER_PER_KM_BOX = 2; // ค่าส่ง 2 บาท ต่อ กม. ต่อ กล่อง
export const BOX_COST = 40; // ต้นทุนข้าวกล่องละ 40 บาท
export const MAX_KM = 3; // ร้านส่งได้เฉพาะลูกค้าที่อยู่ห่างร้าน (เส้นตรง) ไม่เกิน 3 กม.

// ---------- ค่าที่สมมติเพิ่ม (แก้ได้) ----------
export const ROAD_FACTOR = 1.3; // ใช้เมื่อโหลดระยะถนนจริงไม่ได้: ถนนอ้อมกว่าเส้นตรง จึงคูณระยะเส้นตรงเพิ่ม 30%
export const STOP_MINUTES = 5; // เวลาจอดส่งของแต่ละจุด (นาที)
// ระยะทางที่ใช้คิดค่าส่ง = จากร้านไปจุดส่งจุดสุดท้าย (ไม่นับขากลับร้าน)

// ข้อมูลออเดอร์ที่ใช้คำนวณ (มาจากตาราง orders JOIN customers)
export interface PlanOrder {
  id: number;
  customer_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  delivery_address: string;
  delivery_latitude: number;
  delivery_longitude: number;
  quantity: number;
  total_price: number;
}

// =====================================================================
// ส่วนที่ 1: ระยะทาง
// =====================================================================

// ระยะเส้นตรง (กม.) ระหว่าง 2 พิกัดบนผิวโลก (สูตร Haversine)
function straightKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadian = (degree: number) => (degree * Math.PI) / 180;
  const dLat = toRadian(lat2 - lat1);
  const dLng = toRadian(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadian(lat1)) * Math.cos(toRadian(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a)); // 6371 = รัศมีโลก (กม.)
}

// ระยะทางตามถนนจริง: ใช้บริการ OSRM (แผนที่ถนนจาก OpenStreetMap ฟรี)
export const ROAD_API = "https://router.project-osrm.org";

// ระยะถนนจริงที่โหลดมาแล้ว (กม.) เก็บตามคู่พิกัด เช่น "16.246000,103.250000>16.250000,103.260000"
let roadKm = new Map<string, number>();

// ชื่อของพิกัด ใช้เป็น key ใน roadKm เช่น "16.246000,103.250000"
function pointKey(lat: number, lng: number): string {
  return Number(lat).toFixed(6) + "," + Number(lng).toFixed(6);
}

// โหลดระยะถนนจริงระหว่างทุกคู่จุด (ร้าน + จุดส่ง) จาก OSRM ด้วยคำขอเดียว (table service)
// สำเร็จคืนค่า true, เชื่อมต่อไม่ได้ / ช้าเกิน 6 วินาที คืนค่า false แล้วระบบใช้ระยะโดยประมาณแทน
export async function loadRoadDistances(points: { lat: number; lng: number }[]): Promise<boolean> {
  // ใส่ร้านเป็นจุดแรก และตัดจุดซ้ำออก (ลูกค้าคนเดียวกันสั่งหลายออเดอร์)
  const keys: string[] = [pointKey(SHOP.lat, SHOP.lng)];
  const list = [SHOP];
  for (const point of points) {
    const key = pointKey(point.lat, point.lng);
    if (!keys.includes(key)) {
      keys.push(key);
      list.push(point);
    }
  }

  // เคยโหลดครบทุกคู่แล้ว (เช่น กดคำนวณใหม่ / ยืนยันแผน) ไม่ต้องโหลดซ้ำ
  const loadedAll = keys.every((from) => keys.every((to) => roadKm.has(from + ">" + to)));
  if (loadedAll) return true;
  if (list.length > 100) return false; // OSRM รับได้ไม่เกิน 100 จุดต่อครั้ง

  try {
    const coords = list.map((point) => `${Number(point.lng)},${Number(point.lat)}`).join(";");
    const response = await fetch(`${ROAD_API}/table/v1/driving/${coords}?annotations=distance`, {
      signal: AbortSignal.timeout(6000),
    });
    const data: any = await response.json();
    if (!response.ok || data.code !== "Ok") return false;

    if (roadKm.size > 50000) roadKm = new Map<string, number>(); // ไม่ให้หน่วยความจำเต็ม
    // data.distances[i][j] = ระยะ (เมตร) จากจุดที่ i ไปจุดที่ j
    for (let i = 0; i < keys.length; i++) {
      for (let j = 0; j < keys.length; j++) {
        const meters = data.distances[i][j];
        // ไปไม่ถึงทางถนน (null) ไม่เก็บ ให้ใช้ระยะโดยประมาณแทน
        if (typeof meters === "number") {
          roadKm.set(keys[i] + ">" + keys[j], meters / 1000);
        }
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

// ระยะทาง (กม.) จากจุดที่ 1 ไปจุดที่ 2
// มีระยะถนนจริงจาก OSRM ใช้ค่านั้น ไม่มีใช้ระยะเส้นตรง x ROAD_FACTOR
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const road = roadKm.get(pointKey(lat1, lng1) + ">" + pointKey(lat2, lng2));
  if (road !== undefined) return road;
  return straightKm(lat1, lng1, lat2, lng2) * ROAD_FACTOR;
}

// =====================================================================
// ส่วนที่ 2: เขตส่ง 3 กม.
// =====================================================================

// ระยะเส้นตรง (กม.) จากร้านถึงพิกัดนี้
export function shopKm(lat: number, lng: number): number {
  return straightKm(SHOP.lat, SHOP.lng, Number(lat), Number(lng));
}

// ตรวจพิกัดว่าอยู่ในเขตส่งไหม (อยู่ในเขตคืนค่า null, ไม่อยู่คืนข้อความบอกเหตุผล) place เช่น "บ้านลูกค้า", "จุดส่ง"
export function outsideArea(lat: unknown, lng: unknown, place: string): string | null {
  const isEmpty = (value: unknown) => value === null || value === undefined || value === "";
  if (isEmpty(lat) || isEmpty(lng)) {
    return `กรุณาปักหมุด${place}บนแผนที่`;
  }
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return `พิกัด${place}ไม่ถูกต้อง`;
  }
  const km = shopKm(Number(lat), Number(lng));
  if (km > MAX_KM) {
    return `${place}อยู่ห่างร้าน ${km.toFixed(1)} กม. เกินเขตส่ง ${MAX_KM} กม. ร้านส่งไม่ถึง`;
  }
  return null;
}

// =====================================================================
// ส่วนที่ 3: เวลา และตัวเลข
// =====================================================================

// แปลงนาทีนับจากเที่ยงคืนเป็นเวลา เช่น 702 -> "11:42" (เกินเที่ยงคืนวนกลับเป็น 00:xx)
export function toTime(minutes: number): string {
  const total = Math.ceil(minutes);
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

// ปัดทศนิยม 2 ตำแหน่ง
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// เวลาตอนนี้ตามเวลาไทย เป็นนาทีนับจากเที่ยงคืน (ใช้เป็นเวลาออกส่ง)
export function nowMinutes(): number {
  const [hour, minute] = new Date()
    .toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false })
    .split(":");
  return (Number(hour) % 24) * 60 + Number(minute);
}

// =====================================================================
// ส่วนที่ 4: คิด 1 เที่ยว
// =====================================================================

// คำนวณรายละเอียดของ 1 เที่ยว ตามลำดับออเดอร์ที่ให้มา: ระยะทาง เวลาถึงแต่ละจุด ค่าไรเดอร์ กำไร
// start = เวลาออกจากร้าน (นาทีนับจากเที่ยงคืน) ใช้แสดงเวลานาฬิกา, ตอนคิดแผนยังไม่ออกส่ง ใช้ 0 (ดูแค่นาทีที่ใช้)
export function measureRoute(orders: PlanOrder[], start = 0): RouteResult {
  let lat = SHOP.lat; // ตำแหน่งไรเดอร์ตอนนี้ (เริ่มที่ร้าน)
  let lng = SHOP.lng;
  let km = 0;
  let minutes = 0; // นาทีหลังออกจากร้าน
  let boxes = 0;
  let sales = 0;
  let lateCount = 0;
  const stops: StopResult[] = [];

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i] as PlanOrder;
    const legKm = distanceKm(lat, lng, order.delivery_latitude, order.delivery_longitude);
    km = km + legKm;
    minutes = minutes + (legKm / SPEED_KMH) * 60; // เวลาขับ (นาที) = ระยะ / ความเร็ว x 60
    if (minutes > MAX_MINUTES) lateCount = lateCount + 1;
    stops.push({
      seq: i + 1,
      order_id: order.id,
      customer_id: order.customer_id,
      first_name: order.first_name,
      last_name: order.last_name,
      phone: order.phone,
      delivery_address: order.delivery_address,
      latitude: order.delivery_latitude,
      longitude: order.delivery_longitude,
      quantity: order.quantity,
      distance_km: round2(legKm),
      eta: toTime(start + minutes),
      minutes: Math.ceil(minutes),
    });
    minutes = minutes + STOP_MINUTES; // จอดส่งของก่อนไปจุดถัดไป
    boxes = boxes + order.quantity;
    sales = sales + Number(order.total_price);
    lat = order.delivery_latitude;
    lng = order.delivery_longitude;
  }

  // ค่าไรเดอร์ = 15 + 2 x ระยะทางทั้งรอบ x จำนวนกล่องที่ถือไป
  const riderCost = RIDER_BASE + RIDER_PER_KM_BOX * km * boxes;
  const foodCost = boxes * BOX_COST;
  return {
    route_no: 0,
    order_ids: orders.map((order) => order.id),
    stops: stops,
    total_km: round2(km),
    boxes: boxes,
    sales: round2(sales),
    food_cost: foodCost,
    rider_cost: round2(riderCost),
    profit: round2(sales - foodCost - riderCost),
    // เวลาถึงจุดสุดท้าย (ลบเวลาจอดที่บวกไว้ตอนท้ายลูปออก)
    finish_time: toTime(start + minutes - STOP_MINUTES),
    finish_minutes: Math.ceil(minutes - STOP_MINUTES),
    late_orders: lateCount,
  };
}

// ทุกลำดับที่เป็นไปได้ของออเดอร์ (ไม่เกิน 3 ออเดอร์ จึงมีอย่างมาก 6 แบบ)
// เช่น [A, B] -> [A, B], [B, A]
function permutations(list: PlanOrder[]): PlanOrder[][] {
  if (list.length <= 1) return [list];
  const result: PlanOrder[][] = [];
  for (let i = 0; i < list.length; i++) {
    const first = list[i] as PlanOrder;
    const rest = list.filter((_, j) => j !== i);
    for (const restOrder of permutations(rest)) {
      result.push([first, ...restOrder]);
    }
  }
  return result;
}

// เก็บผลของกลุ่มออเดอร์ที่เคยคำนวณแล้ว (กลุ่มเดิมไม่ต้องคิดซ้ำ ทำให้คำนวณเร็วขึ้นมาก)
let savedBest = new Map<string, RouteResult>();

// หาลำดับการส่งที่ดีที่สุดของ 1 เที่ยว: ลองทุกลำดับ เลือกที่ไม่เลท และค่าไรเดอร์น้อยสุด
// (ค่าไรเดอร์คิดตามระยะทั้งรอบ ลำดับที่ระยะสั้นสุดจึงถูกสุด เช่น จุดใกล้ร้านส่งก่อน)
function bestRoute(orders: PlanOrder[]): RouteResult {
  // ชื่อกลุ่ม = รหัสออเดอร์เรียงจากน้อยไปมาก เช่น "3,8,12" (สลับลำดับมาก็ได้ชื่อเดิม)
  const key = orders
    .map((order) => order.id)
    .sort((x, y) => x - y)
    .join(",");
  const saved = savedBest.get(key);
  if (saved) return saved;

  let best: RouteResult | null = null;
  for (const order of permutations(orders)) {
    const route = measureRoute(order);
    const lessLate = best !== null && route.late_orders < best.late_orders;
    const sameLateButCheaper =
      best !== null && route.late_orders === best.late_orders && route.rider_cost < best.rider_cost;
    if (best === null || lessLate || sameLateButCheaper) {
      best = route;
    }
  }
  savedBest.set(key, best as RouteResult);
  return best as RouteResult;
}

// ค่าใช้จ่ายของเที่ยวไว้เปรียบเทียบ = ค่าไรเดอร์ (ถ้ามีจุดเลท บวกเพิ่มแพงมากๆ เพื่อไม่ให้เลือกแบบนี้)
function routeCost(route: RouteResult): number {
  return route.rider_cost + route.late_orders * 100000;
}

// ค่าใช้จ่ายรวมของหลายเที่ยว
function totalCost(routes: RouteResult[]): number {
  let sum = 0;
  for (const route of routes) sum = sum + routeCost(route);
  return sum;
}

// ดึงข้อมูลออเดอร์ตามรหัสที่ให้มา (เรียงตามรหัสที่ให้)
// ฟังก์ชันนี้ถูกเรียกบ่อยมาก จึงสร้างตาราง รหัส -> ออเดอร์ ของแต่ละรายการไว้ครั้งเดียว แล้วจำไว้ใช้ซ้ำ
const orderTables = new WeakMap<PlanOrder[], Map<number, PlanOrder>>();
export function ordersOf(orders: PlanOrder[], ids: number[]): PlanOrder[] {
  let table = orderTables.get(orders);
  if (!table) {
    table = new Map<number, PlanOrder>();
    for (const order of orders) table.set(order.id, order);
    orderTables.set(orders, table);
  }
  const result: PlanOrder[] = [];
  for (const id of ids) {
    const order = table.get(id);
    if (order) result.push(order);
  }
  return result;
}

// =====================================================================
// ส่วนที่ 5: จัดทั้งแผน (แบ่งออเดอร์ให้ไรเดอร์หลายคน)
// =====================================================================

// การรวม 2 เที่ยวเป็นเที่ยวเดียว และเงินที่ประหยัดได้
interface Merge {
  routeA: RouteResult;
  routeB: RouteResult;
  merged: RouteResult; // เที่ยวใหม่หลังรวม
  saving: number; // ค่าไรเดอร์ที่ลดลง
}

// จัดเส้นทาง 1 แบบ
// 1) เริ่มจากให้ไรเดอร์ 1 คนต่อ 1 ออเดอร์
// 2) รวมเที่ยวที่อยู่ใกล้กันเข้าด้วยกัน ถ้ารวมแล้วค่าไรเดอร์รวมลดลง (วิธี Savings) จนรวมต่อไม่ได้
// 3) ลองย้าย / สลับออเดอร์ระหว่างไรเดอร์ ถ้าค่าใช้จ่ายลดลงก็เปลี่ยน
// 4) จำนวนเที่ยวต้องไม่เกินจำนวนไรเดอร์ที่มี (maxRoutes) ถ้าเกินให้ยุบเที่ยวรวมกัน
// random = true จะสุ่มเลือกการรวมจาก 3 อันดับแรก เพื่อให้ได้เส้นทางแบบอื่นมาเสนอ
function buildRoutes(orders: PlanOrder[], random: boolean, maxRoutes: number): RouteResult[] {
  // ขั้นที่ 1: 1 ออเดอร์ = 1 เที่ยว
  let routes: RouteResult[] = orders.map((order) => bestRoute([order]));

  // ลองรวม 2 เที่ยว: รวมได้และประหยัดได้จริง คืนค่าการรวม ไม่งั้นคืนค่า null
  const tryMerge = (routeA: RouteResult, routeB: RouteResult): Merge | null => {
    if (routeA.order_ids.length + routeB.order_ids.length > MAX_ORDERS) return null;
    const merged = bestRoute(ordersOf(orders, [...routeA.order_ids, ...routeB.order_ids]));
    if (merged.late_orders > 0) return null;
    const saving = routeCost(routeA) + routeCost(routeB) - routeCost(merged);
    if (saving > 0.01) {
      return { routeA: routeA, routeB: routeB, merged: merged, saving: saving };
    }
    return null;
  };

  // ขั้นที่ 2: คิดผลประหยัดของทุกคู่ไว้ก่อน รวมคู่ที่ประหยัดสุด แล้วคิดเพิ่มเฉพาะคู่ของเที่ยวใหม่ (เร็วกว่าคิดใหม่ทุกคู่)
  let merges: Merge[] = [];
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const merge = tryMerge(routes[i] as RouteResult, routes[j] as RouteResult);
      if (merge) merges.push(merge);
    }
  }
  while (merges.length > 0) {
    merges.sort((x, y) => y.saving - x.saving); // ประหยัดมากสุดอยู่หน้าสุด
    const pickIndex = random ? Math.floor(nextRandom() * Math.min(3, merges.length)) : 0;
    const pick = merges[pickIndex] as Merge;
    // เอา 2 เที่ยวเดิมออก และทิ้งการรวมอื่นที่ใช้เที่ยวเดิมนั้น (เที่ยวเดิมไม่มีแล้ว)
    const isOld = (route: RouteResult) => route === pick.routeA || route === pick.routeB;
    routes = routes.filter((route) => !isOld(route));
    merges = merges.filter((merge) => !isOld(merge.routeA) && !isOld(merge.routeB));
    // คิดการรวมของเที่ยวใหม่กับเที่ยวอื่นที่เหลือ
    for (const route of routes) {
      const merge = tryMerge(route, pick.merged);
      if (merge) merges.push(merge);
    }
    routes.push(pick.merged);
  }

  // ขั้นที่ 3: ปรับปรุงด้วยการย้าย / สลับออเดอร์
  routes = improve(orders, routes);

  // ขั้นที่ 4: ไรเดอร์มีไม่พอ ยุบเที่ยวทีละเที่ยว จนเหลือเท่าจำนวนไรเดอร์
  if (routes.length > maxRoutes) {
    while (routes.length > maxRoutes) {
      const fewer = removeOneRoute(orders, routes);
      if (fewer === null) break; // ยุบไม่ได้แล้ว (ส่งไม่ทันเวลา) แผนนี้ใช้ไม่ได้
      routes = fewer;
    }
    routes = improve(orders, routes);
  }
  return routes;
}

// ลองยุบ 1 เที่ยว: เอาออเดอร์ของเที่ยวนั้นไปใส่เที่ยวอื่นที่ยังไม่เต็ม 3 ออเดอร์ (ต้องไม่เลท)
// ลองยุบทีละเที่ยว แล้วเลือกแบบที่ค่าใช้จ่ายรวมน้อยสุด คืนค่า null ถ้ายุบเที่ยวไหนไม่ได้เลย
function removeOneRoute(orders: PlanOrder[], routes: RouteResult[]): RouteResult[] | null {
  let best: RouteResult[] | null = null;
  let bestCost = Infinity;
  for (let k = 0; k < routes.length; k++) {
    const removed = routes[k] as RouteResult;
    let rest = routes.filter((_, i) => i !== k);
    let canRemove = true;
    for (const id of removed.order_ids) {
      // หาเที่ยวที่ใส่ออเดอร์ id แล้วค่าไรเดอร์เพิ่มน้อยสุด
      let pickIndex = -1;
      let pickRoute: RouteResult | null = null;
      let pickAdd = Infinity;
      for (let i = 0; i < rest.length; i++) {
        const route = rest[i] as RouteResult;
        if (route.order_ids.length >= MAX_ORDERS) continue; // เต็มแล้ว
        const merged = bestRoute(ordersOf(orders, [...route.order_ids, id]));
        if (merged.late_orders > 0) continue; // ใส่แล้วเลท
        const add = merged.rider_cost - route.rider_cost;
        if (add < pickAdd) {
          pickAdd = add;
          pickIndex = i;
          pickRoute = merged;
        }
      }
      if (pickRoute === null) {
        canRemove = false; // ออเดอร์นี้ไม่มีเที่ยวไหนรับได้
        break;
      }
      rest = rest.map((route, i) => (i === pickIndex ? (pickRoute as RouteResult) : route));
    }
    if (!canRemove) continue;
    const cost = totalCost(rest);
    if (cost < bestCost) {
      bestCost = cost;
      best = rest;
    }
  }
  return best;
}

// ลองย้าย / สลับออเดอร์ระหว่างไรเดอร์ 2 คน ถ้าค่าใช้จ่ายลดลงก็เปลี่ยนทันที แล้วลองคู่ต่อไป ไล่ซ้ำจนลดไม่ได้อีก
function improve(orders: PlanOrder[], start: RouteResult[]): RouteResult[] {
  const routes: (RouteResult | null)[] = [...start]; // null = เที่ยวที่ถูกย้ายออเดอร์ออกหมดแล้ว
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < routes.length; i++) {
      for (let j = 0; j < routes.length; j++) {
        const routeA = routes[i];
        const routeB = routes[j];
        if (i === j || !routeA || !routeB) continue;
        const before = routeCost(routeA) + routeCost(routeB);
        let changed = false;
        for (const idA of routeA.order_ids) {
          // แบบที่ 1: ย้ายออเดอร์ idA จากเที่ยว A ไปเที่ยว B
          if (routeB.order_ids.length < MAX_ORDERS) {
            const restA = routeA.order_ids.filter((id) => id !== idA);
            const newB = bestRoute(ordersOf(orders, [...routeB.order_ids, idA]));
            const newA = restA.length > 0 ? bestRoute(ordersOf(orders, restA)) : null;
            const after = routeCost(newB) + (newA ? routeCost(newA) : 0);
            if (after < before - 0.01) {
              routes[i] = newA;
              routes[j] = newB;
              changed = true;
              break;
            }
          }
          // แบบที่ 2: สลับออเดอร์ idA ของเที่ยว A กับออเดอร์ idB ของเที่ยว B
          for (const idB of routeB.order_ids) {
            const newA = bestRoute(ordersOf(orders, [...routeA.order_ids.filter((id) => id !== idA), idB]));
            const newB = bestRoute(ordersOf(orders, [...routeB.order_ids.filter((id) => id !== idB), idA]));
            if (routeCost(newA) + routeCost(newB) < before - 0.01) {
              routes[i] = newA;
              routes[j] = newB;
              changed = true;
              break;
            }
          }
          if (changed) break;
        }
        if (changed) improved = true;
      }
    }
  }
  return routes.filter((route) => route !== null) as RouteResult[];
}

// รวมเที่ยวทั้งหมดเป็น 1 แผน พร้อมสรุปยอดขาย ต้นทุน ค่าไรเดอร์ กำไร และเวลาส่งเสร็จ
export function summarize(routes: RouteResult[]): PlanResult {
  // เรียงเที่ยวตามทิศรอบร้าน (มุมของจุดแรก) ให้ไรเดอร์คนที่ 1, 2, 3 ... ไล่ตามทิศ ดูบนแผนที่ง่าย
  const angle = (route: RouteResult) => {
    const first = route.stops[0] as StopResult;
    return Math.atan2(first.latitude - SHOP.lat, first.longitude - SHOP.lng);
  };
  // คัดลอกเที่ยวก่อนเรียง (เที่ยวเดียวกันอาจใช้ร่วมกันหลายแผน)
  const sorted = routes.map((route) => ({ ...route })).sort((a, b) => angle(a) - angle(b));

  let km = 0;
  let boxes = 0;
  let sales = 0;
  let riderCost = 0;
  let lateCount = 0;
  let finishTime = "";
  let finishMinutes = 0;
  let orderCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    const route = sorted[i] as RouteResult;
    route.route_no = i + 1;
    km = km + route.total_km;
    boxes = boxes + route.boxes;
    sales = sales + route.sales;
    riderCost = riderCost + route.rider_cost;
    lateCount = lateCount + route.late_orders;
    orderCount = orderCount + route.order_ids.length;
    // เวลาส่งเสร็จของทั้งแผน = เที่ยวที่ถึงจุดสุดท้ายช้าที่สุด
    if (finishTime === "" || route.finish_minutes > finishMinutes) {
      finishTime = route.finish_time;
      finishMinutes = route.finish_minutes;
    }
  }
  const foodCost = boxes * BOX_COST;
  return {
    riders: sorted.length,
    orders: orderCount,
    boxes: boxes,
    total_km: round2(km),
    sales: round2(sales),
    food_cost: foodCost,
    rider_cost: round2(riderCost),
    profit: round2(sales - foodCost - riderCost),
    finish_time: finishTime,
    finish_minutes: finishMinutes,
    late_orders: lateCount,
    routes: sorted,
  };
}

// ตัวสุ่มที่ได้ลำดับเลขเดิมทุกครั้งเมื่อเริ่มจากเลขตั้งต้นเดียวกัน (ออเดอร์ชุดเดิมได้แผนชุดเดิม ผลไม่เปลี่ยนไปมา)
let randomSeed = 1;
function nextRandom(): number {
  randomSeed = (randomSeed * 16807) % 2147483647;
  return randomSeed / 2147483647;
}

// แผนที่ต่างจากแผนนี้เล็กน้อย ใช้เป็นแผนทางเลือก (ทุกแผนต้องไม่เลท ไรเดอร์ 1 คนไม่เกิน 3 ออเดอร์ และใช้ไรเดอร์ไม่เกิน maxRoutes คน)
// 1) ย้าย 1 ออเดอร์ไปให้ไรเดอร์อีกคน  2) สลับออเดอร์ของไรเดอร์ 2 คน
// 3) แยก 1 ออเดอร์ไปให้ไรเดอร์ที่ยังว่าง  4) เปลี่ยนลำดับจุดส่งของไรเดอร์ 1 คน
function nearbyPlans(orders: PlanOrder[], routes: RouteResult[], maxRoutes: number): RouteResult[][] {
  const result: RouteResult[][] = [];
  const noLate = (list: RouteResult[]) => list.every((route) => route.late_orders === 0);
  // แทนเที่ยวที่ i และ j ด้วยเที่ยวใหม่ (ไม่มีออเดอร์เหลือ = ไม่ใช้ไรเดอร์คนนั้น)
  const replace = (i: number, j: number, newRoutes: RouteResult[]) => {
    const list = routes.filter((_, k) => k !== i && k !== j);
    if (noLate(newRoutes)) result.push([...list, ...newRoutes]);
  };

  for (let i = 0; i < routes.length; i++) {
    const routeA = routes[i] as RouteResult;
    for (const idA of routeA.order_ids) {
      const restA = routeA.order_ids.filter((id) => id !== idA);
      const newA = restA.length > 0 ? [bestRoute(ordersOf(orders, restA))] : [];
      // แบบที่ 3: แยกออเดอร์ idA ไปให้ไรเดอร์ที่ว่างอีกคน
      if (restA.length > 0 && routes.length < maxRoutes) {
        replace(i, i, [...newA, bestRoute(ordersOf(orders, [idA]))]);
      }
      for (let j = 0; j < routes.length; j++) {
        const routeB = routes[j] as RouteResult;
        if (i === j) continue;
        // แบบที่ 1: ย้ายออเดอร์ idA จากเที่ยว A ไปเที่ยว B
        if (routeB.order_ids.length < MAX_ORDERS) {
          replace(i, j, [...newA, bestRoute(ordersOf(orders, [...routeB.order_ids, idA]))]);
        }
        // แบบที่ 2: สลับออเดอร์ idA กับ idB (คิดคู่ละครั้ง i < j)
        if (i < j) {
          for (const idB of routeB.order_ids) {
            const swapA = bestRoute(ordersOf(orders, [...restA, idB]));
            const swapB = bestRoute(ordersOf(orders, [...routeB.order_ids.filter((id) => id !== idB), idA]));
            replace(i, j, [swapA, swapB]);
          }
        }
      }
    }
    // แบบที่ 4: เปลี่ยนลำดับจุดส่ง (ลำดับที่ดีที่สุดมีอยู่ในแผนเดิมแล้ว)
    if (routeA.order_ids.length >= 2) {
      for (const order of permutations(ordersOf(orders, routeA.order_ids))) {
        const route = measureRoute(order);
        if (route.order_ids.join(",") !== routeA.order_ids.join(",")) replace(i, i, [route]);
      }
    }
  }
  return result;
}

// ชื่อแผน = ออเดอร์ของแต่ละเที่ยวตามลำดับส่ง เช่น "1,5|2,9,3|4" (แผนที่ชื่อเหมือนกันคือแผนเดียวกัน)
function planKey(plan: PlanResult): string {
  return plan.routes
    .map((route) => route.order_ids.join(","))
    .sort()
    .join("|");
}

// ผลการจัดเส้นทาง: แผนที่เสนอในครั้งนี้ (ไม่เกิน 3 แบบ) + จำนวนแผนทั้งหมดที่หาได้
export interface PlanPage {
  plans: PlanResult[];
  keys: string[]; // ชื่อของแต่ละแผนใน plans (หน้าเว็บส่งกลับมาตอนกด "ขอดูแบบอื่น" เพื่อไม่ให้ได้แบบเดิมซ้ำ)
  total: number; // จำนวนแผนทั้งหมดที่หาได้ (ไม่ซ้ำกัน)
  restart: boolean; // true = ดูครบทุกแบบแล้ว วนกลับไปเริ่มที่แบบแรก
}

export const MAX_PLANS = 30; // เก็บแผนทางเลือกไว้ไม่เกิน 30 แบบ (ค่าใช้จ่ายน้อยสุดก่อน)

// เสนอแผนเส้นทางครั้งละ 3 แบบ (ค่าใช้จ่ายน้อยสุดก่อน) ใช้ไรเดอร์ไม่เกิน maxRoutes คน (หาแผนไม่ได้ plans = [])
// seen = ชื่อแผนที่ผู้ใช้ดูไปแล้ว (กด "ขอดูแบบอื่น") จะเสนอเฉพาะแผนที่ยังไม่เคยดู ดูครบทุกแบบแล้ววนกลับไปแบบแรก
export function makePlans(orders: PlanOrder[], seen: string[], maxRoutes: number): PlanPage {
  savedBest = new Map<string, RouteResult>();
  randomSeed = 1;
  const found: PlanResult[] = [];
  const foundKeys: string[] = [];
  const startTime = Date.now();
  const usedTime = () => Date.now() - startTime;

  // เก็บแผนที่ใช้ได้ (ไม่เลท ไรเดอร์พอ) และไม่ซ้ำกับที่เจอแล้ว
  const keySet = new Set<string>();
  const keep = (routes: RouteResult[]) => {
    const plan = summarize(routes);
    if (plan.riders > maxRoutes || plan.late_orders > 0) return;
    const key = planKey(plan);
    if (!keySet.has(key)) {
      keySet.add(key);
      found.push(plan);
      foundKeys.push(key);
    }
  };

  // ขั้นที่ 1: จัดเส้นทาง 80 แบบ (แบบแรกไม่สุ่ม แบบต่อไปสุ่ม) ออเดอร์เยอะจนเกิน 3 วินาที หยุดก่อน
  const built: RouteResult[][] = [];
  for (let i = 0; i < 80; i++) {
    if (i >= 5 && usedTime() >= 3000) break;
    const routes = buildRoutes(orders, i > 0, maxRoutes);
    built.push(routes);
    keep(routes);
  }

  // ขั้นที่ 2: การจัดแบบสุ่มมักได้แผนเดิมซ้ำ จึงสร้างแผนทางเลือกจากแผนที่ดีที่สุด 5 แบบแรก โดยปรับทีละนิด
  // (ย้าย / สลับ / แยกออเดอร์ / เปลี่ยนลำดับจุดส่ง) ได้แผนที่ต่างจากเดิมจริงและยังส่งทันเวลา
  built.sort((a, b) => totalCost(a) - totalCost(b));
  const bases: RouteResult[][] = [];
  const baseKeys = new Set<string>();
  for (const routes of built) {
    const key = planKey(summarize(routes));
    if (bases.length < 5 && !baseKeys.has(key)) {
      baseKeys.add(key);
      bases.push(routes);
    }
  }
  for (let i = 0; i < bases.length; i++) {
    if (i >= 1 && usedTime() >= 4000) break; // แผนแรกทำเสมอ แผนต่อไปทำเมื่อยังไม่ช้าเกิน
    for (const other of nearbyPlans(orders, bases[i] as RouteResult[], maxRoutes)) keep(other);
  }

  // ไม่เลทก่อน แล้วเรียงค่าไรเดอร์จากน้อยไปมาก เก็บไว้ไม่เกิน MAX_PLANS แบบ
  const order = found.map((_, i) => i);
  order.sort((a, b) => {
    const planA = found[a] as PlanResult;
    const planB = found[b] as PlanResult;
    return planA.late_orders - planB.late_orders || planA.rider_cost - planB.rider_cost;
  });
  const top = order.slice(0, MAX_PLANS);

  // เลือก 3 แบบแรกที่ผู้ใช้ยังไม่เคยดู ถ้าดูครบทุกแบบแล้ว เริ่มใหม่ที่แบบแรก
  let fresh = top.filter((i) => !seen.includes(foundKeys[i] as string));
  const restart = fresh.length === 0;
  if (restart) fresh = top;
  const pick = fresh.slice(0, 3);
  return {
    plans: pick.map((i) => found[i] as PlanResult),
    keys: pick.map((i) => foundKeys[i] as string),
    total: top.length,
    restart: restart && seen.length > 0,
  };
}
