// โมเดลข้อมูลลูกค้า ตาราง customers
export interface Customer {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  address: string;
  latitude: number;
  longitude: number;
  is_simulated?: number; // 1 = ลูกค้าจำลอง
  created_at: string;
  updated_at: string;
}
