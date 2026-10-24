import { useEffect, useState } from "react";
import { ApiError, fetchOrder } from "../api/client";
import type { Order } from "../types";

export function useOrderPolling(
  orderId: string | null,
  initialOrder: Order | null,
) {
  const [order, setOrder] = useState<Order | null>(initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  useEffect(() => {
    setOrder(initialOrder);
  }, [initialOrder]);

  useEffect(() => {
    if (!orderId) {
      return;
    }

    // If order has already reached a terminal/review status, no need to poll
    if (order && order.status !== "pending") {
      setIsPolling(false);
      return;
    }

    let isCancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let abortController: AbortController | null = null;

    async function poll() {
      if (isCancelled) return;

      abortController = new AbortController();
      setIsPolling(true);

      try {
        const updated = await fetchOrder(orderId!, abortController.signal);
        if (isCancelled) return;

        setOrder(updated);
        setError(null);

        // If order transitioned to paid, expired, needs_review, or picked_up, cease polling
        if (updated.status !== "pending") {
          setIsPolling(false);
          return;
        }

        // Schedule next poll in 1.5 seconds
        timerId = setTimeout(poll, 1500);
      } catch (err: any) {
        if (isCancelled || err.name === "AbortError") {
          return;
        }
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Network connection interrupted. Reconnecting to pickup counter...");
        }
        // Retry polling on temporary network glitches
        timerId = setTimeout(poll, 3000);
      } finally {
        if (!isCancelled && (!order || order.status !== "pending")) {
          setIsPolling(false);
        }
      }
    }

    // Kick off first poll after short delay (1.2s)
    timerId = setTimeout(poll, 1200);

    return () => {
      isCancelled = true;
      if (timerId) clearTimeout(timerId);
      if (abortController) abortController.abort();
    };
  }, [orderId, order?.status]);

  return {
    order,
    setOrder,
    error,
    isPolling,
  };
}
