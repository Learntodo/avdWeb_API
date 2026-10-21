// โมเดลข้อมูลเส้นทางส่ง (แผนที่คำนวณ และใบงานที่บันทึกในตาราง routes / route_stops)

// จุดส่ง 1 จุดในเที่ยว
export interface StopResult {
  seq: number; // จุดที่ 1, 2, 3
  order_id: number;
  customer_id: number; // รหัสลูกค้า (ตรงกับหน้าลูกค้า)
  first_name: string;
  last_name: string;
  phone: string;
  delivery_address: string;
  latitude: number;
  longitude: number;
  quantity: number;
  distance_km: number; // ระยะจากจุดก่อนหน้า (จุดแรก = จากร้าน)
  eta: string; // เวลาถึงโดยประมาณ เช่น "11:42"
  status?: string; // สถานะออเดอร์ (มีเฉพาะใบงานที่บันทึกแล้ว)
}

// ไรเดอร์ที่รับใบงาน
export interface RouteRider {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
}

// 1 เที่ยว = งานของไรเดอร์ 1 คน
export interface RouteResult {
  route_no: number; // เที่ยวที่
  rider?: RouteRider | null; // ไรเดอร์ที่รับใบงาน (มีเฉพาะใบงานที่บันทึกแล้ว)
  order_ids: number[];
  stops: StopResult[];
  total_km: number;
  boxes: number;
  sales: number;
  food_cost: number;
  rider_cost: number;
  profit: number;
  finish_time: string; // เวลาถึงจุดสุดท้าย
  late_orders: number; // จำนวนจุดที่ถึงเกิน 12:30
}

// แผนการส่งทั้งร้าน
export interface PlanResult {
  riders: number;
  orders: number;
  boxes: number;
  total_km: number;
  sales: number;
  food_cost: number;
  rider_cost: number;
  profit: number;
  finish_time: string;
  late_orders: number;
  routes: RouteResult[];
}

// แถวในตาราง routes (ใบงาน 1 ใบ)
export interface Route {
  id: number;
  code: string; // เลขใบงานที่ให้ไรเดอร์กรอก
  delivery_date: string;
  route_no: number;
  rider_id: number | null; // ไรเดอร์ที่รับใบงาน (ตาราง users)
  total_km: number;
  boxes: number;
  rider_cost: number;
  finish_time: string;
  created_at: string;
}
