// โมเดลข้อมูลรายการสั่งซื้อ ตาราง orders
export interface Order {
  id: number;
  customer_id: number;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_address: string;
  delivery_latitude: number;
  delivery_longitude: number;
  delivery_date: string;
  status: string;
  is_simulated: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  // ข้อมูลลูกค้าที่สั่ง (ได้จากการ JOIN ตาราง customers)
  first_name?: string;
  last_name?: string;
  phone?: string;
}
