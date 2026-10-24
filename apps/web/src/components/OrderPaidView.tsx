import { useState } from "react";
import { claimOrderPickup } from "../api/client";
import type { Order, PickupClaimResult } from "../types";
import { formatPaise } from "../utils/format";

interface OrderPaidViewProps {
  order: Order;
  onClaimSuccess: (claim: PickupClaimResult) => void;
  onOrderExpired: () => void;
}

export function OrderPaidView({
  order,
  onClaimSuccess,
}: OrderPaidViewProps) {
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const handleClaim = async () => {
    setIsClaiming(true);
    setClaimError(null);
    try {
      const result = await claimOrderPickup(order.id, "locker_01");
      onClaimSuccess(result);
    } catch (err: any) {
      if (err.statusCode === 409) {
        setClaimError(
          "This order has already been claimed or is in an invalid state for pickup.",
        );
      } else {
        setClaimError(err.message || "Failed to claim pickup from locker.");
      }
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="order-view-card paid-card" role="region" aria-labelledby="paid-heading">
      <div className="status-header">
        <span className="status-badge badge-paid">Payment Accepted</span>
        <span className="locker-pill">Locker Ready: Counter 01</span>
      </div>

      <div className="paid-hero">
        <span className="paid-icon" aria-hidden="true">
          ✅
        </span>
        <h2 id="paid-heading" className="order-title">Ready for Pickup!</h2>
        <p className="order-lead">
          Your payment of <strong>{formatPaise(order.totalPaise)}</strong> was successfully verified. Your snacks are waiting in Locker 01.
        </p>
      </div>

      {claimError && (
        <div className="alert alert-error" role="alert">
          <span>⚠️ {claimError}</span>
        </div>
      )}

      <div className="order-details-box">
        <div className="detail-row">
          <span className="detail-key">Order Reference:</span>
          <code className="detail-code">{order.id}</code>
        </div>
        <div className="detail-row">
          <span className="detail-key">Assigned Locker:</span>
          <strong>Locker Counter 01</strong>
        </div>
        <div className="detail-row">
          <span className="detail-key">Items to Collect:</span>
          <span>
            {order.items.reduce((s, i) => s + i.quantity, 0)} items total
          </span>
        </div>
      </div>

      <div className="order-items-summary">
        <h3>Items</h3>
        <ul>
          {order.items.map((item, idx) => (
            <li key={idx} className="summary-item">
              <span>
                {item.quantity}x {item.product_name}
              </span>
              <span>{formatPaise(item.subtotal_paise)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="claim-action-area">
        <button
          className="btn btn-success btn-large claim-btn"
          onClick={handleClaim}
          disabled={isClaiming}
        >
          {isClaiming ? (
            <>
              <span className="spinner"></span> Opening Locker Door...
            </>
          ) : (
            "🔓 Open Locker & Claim Snacks"
          )}
        </button>
        <p className="claim-subtext">
          Pressing this button atomically decrements stock in PostgreSQL and marks the order collected.
        </p>
      </div>
    </div>
  );
};
