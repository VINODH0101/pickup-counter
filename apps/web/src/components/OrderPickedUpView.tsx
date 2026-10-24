import type { Order, PickupClaimResult } from "../types";
import { formatPaise } from "../utils/format";

interface OrderPickedUpViewProps {
  order: Order;
  claimResult?: PickupClaimResult | null;
  onNewOrder: () => void;
}

export function OrderPickedUpView({
  order,
  claimResult,
  onNewOrder,
}: OrderPickedUpViewProps) {
  const claimedAtString = claimResult?.claimedAt
    ? new Date(claimResult.claimedAt).toLocaleTimeString()
    : new Date().toLocaleTimeString();

  return (
    <div className="order-view-card picked-up-card" role="region" aria-labelledby="picked-up-heading">
      <div className="status-header">
        <span className="status-badge badge-picked-up">Collected</span>
        <span className="locker-pill">Locker {claimResult?.lockerId || "01"}</span>
      </div>

      <div className="picked-up-hero">
        <span className="hero-emoji" aria-hidden="true">
          🎉
        </span>
        <h2 id="picked-up-heading" className="order-title">Snacks Collected!</h2>
        <p className="order-lead">
          Locker door unlocked at <strong>{claimedAtString}</strong>. Physical inventory has been decremented and your order is complete.
        </p>
      </div>

      <div className="order-details-box">
        <div className="detail-row">
          <span className="detail-key">Order Reference:</span>
          <code className="detail-code">{order.id}</code>
        </div>
        <div className="detail-row">
          <span className="detail-key">Total Paid:</span>
          <strong>{formatPaise(order.totalPaise)}</strong>
        </div>
        <div className="detail-row">
          <span className="detail-key">Audit Status:</span>
          <span className="audit-tag">Atomic DB Record Recorded</span>
        </div>
      </div>

      <div className="order-items-summary">
        <h3>Items Collected</h3>
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

      <div className="new-order-area">
        <button className="btn btn-primary btn-large" onClick={onNewOrder}>
          🛍️ Order More Snacks
        </button>
      </div>
    </div>
  );
};
