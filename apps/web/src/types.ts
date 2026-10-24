export interface Product {
  id: string;
  name: string;
  price_paise: number;
  stock_units: number;
  available_units: number;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_paise: number;
  subtotal_paise: number;
}

export type OrderStatus =
  | "pending"
  | "paid"
  | "picked_up"
  | "expired"
  | "needs_review";

export interface Order {
  id: string;
  orderId: string;
  status: OrderStatus;
  totalPaise: number;
  total_paise: number;
  items: OrderItem[];
  created_at: string;
  expires_at: string;
  expiresInSeconds: number;
}

export interface PickupClaimResult {
  orderId: string;
  status: "picked_up";
  lockerId: string;
  claimedAt: string;
  success?: boolean;
}
