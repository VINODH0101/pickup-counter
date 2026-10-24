import type { Order, PickupClaimResult, Product } from "../types";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// In Vite development, "/api" is proxied to the backend on port 3001.
// Direct fallback to http://127.0.0.1:3001 can be configured via VITE_API_URL.
const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  let res: Response;

  try {
    res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw err;
    }
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Unable to communicate with the Pickup Counter server. Please check your connection.",
    );
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const errorCode = data.error || (data.code ?? "UNKNOWN_ERROR");
    const errorMessage = data.message || (typeof data.error === "string" ? data.error : "Request failed");
    throw new ApiError(res.status, errorCode, errorMessage);
  }

  return data as T;
}

export async function fetchProducts(signal?: AbortSignal): Promise<Product[]> {
  return request<Product[]>("/products", { signal });
}

export async function createOrder(
  items: { productId: string; quantity: number }[],
  signal?: AbortSignal,
): Promise<Order> {
  return request<Order>("/orders", {
    method: "POST",
    body: JSON.stringify({ items }),
    signal,
  });
}

export async function fetchOrder(
  orderId: string,
  signal?: AbortSignal,
): Promise<Order> {
  return request<Order>(`/orders/${orderId}`, { signal });
}

export async function claimOrderPickup(
  orderId: string,
  lockerId: string = "locker_01",
  signal?: AbortSignal,
): Promise<PickupClaimResult> {
  return request<PickupClaimResult>(`/orders/${orderId}/pickup-claim`, {
    method: "POST",
    body: JSON.stringify({ lockerId }),
    signal,
  });
}

export async function simulatePayment(
  orderId: string,
  amountPaise: number,
  status: string = "captured",
  signal?: AbortSignal,
): Promise<any> {
  return request<any>("/payments/simulate", {
    method: "POST",
    body: JSON.stringify({ orderId, amountPaise, status }),
    signal,
  });
}
