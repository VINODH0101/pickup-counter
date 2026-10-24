import type { Order } from "../types";
import { formatPaise } from "../utils/format";

interface OrderExpiredViewProps {
  order: Order;
  onNewOrder: () => void;
}

export function OrderExpiredView({
  order,
  onNewOrder,
}: OrderExpiredViewProps) {
  return (
    <div className="order-view-card expired-card" role="region" aria-labelledby="expired-heading">
      <div className="status-header">
        <span className="status-badge badge-expired">Hold Expired</span>
      </div>

      <div className="expired-hero">
        <span className="hero-emoji" aria-hidden="true">
          ⏱️
        </span>
        <h2 id="expired-heading" className="order-title">Stock Reservation Elapsed</h2>
        <p className="order-lead">
          The 120-second stock hold expired before payment was verified. Your reserved snacks have been released back to the counter inventory.
        </p>
      </div>

      <div className="order-details-box">
        <div className="detail-row">
          <span className="detail-key">Order Reference:</span>
          <code className="detail-code">{order.id}</code>
        </div>
        <div className="detail-row">
          <span className="detail-key">Unpaid Total:</span>
          <span>{formatPaise(order.totalPaise)}</span>
        </div>
      </div>

      <div className="expired-actions">
        <p className="expired-explanation">
          To purchase these items, return to the catalog and start a new checkout. If other customers have not purchased them, you can reserve them again immediately.
        </p>
        <button className="btn btn-primary btn-large" onClick={onNewOrder}>
          Browse Catalog Again
        </button>
      </div>
    </div>
  );
};
