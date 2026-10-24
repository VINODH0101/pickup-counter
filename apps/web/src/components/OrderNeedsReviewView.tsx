import { useState } from "react";
import type { Order } from "../types";
import { formatPaise } from "../utils/format";

interface OrderNeedsReviewViewProps {
  order: Order;
  onNewOrder: () => void;
}

export function OrderNeedsReviewView({
  order,
  onNewOrder,
}: OrderNeedsReviewViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyOrderId = () => {
    navigator.clipboard.writeText(order.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="order-view-card review-card" role="region" aria-labelledby="review-heading">
      <div className="status-header">
        <span className="status-badge badge-review">Requires Staff Review</span>
      </div>

      <div className="review-hero">
        <span className="hero-emoji" aria-hidden="true">
          ⚠️
        </span>
        <h2 id="review-heading" className="order-title">Payment Reconciliation Required</h2>
        <p className="order-lead">
          Your payment could not be automatically accepted by the automated locker counter.
        </p>
      </div>

      <div className="alert alert-warning">
        <div className="alert-content">
          <strong>Why did this happen?</strong>
          <ul>
            <li>The payment amount may not match the order total ({formatPaise(order.totalPaise)}), or</li>
            <li>The payment arrived after the 120-second stock hold expired and stock was freed.</li>
          </ul>
        </div>
      </div>

      <div className="order-details-box">
        <div className="detail-row">
          <span className="detail-key">Order UUID:</span>
          <div className="copy-row">
            <code className="detail-code">{order.id}</code>
            <button
              className="btn btn-secondary btn-small copy-btn"
              onClick={handleCopyOrderId}
              aria-label="Copy order ID to clipboard"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
        <div className="detail-row">
          <span className="detail-key">Order Total:</span>
          <strong>{formatPaise(order.totalPaise)}</strong>
        </div>
      </div>

      <div className="review-action-area">
        <p className="staff-instructions">
          Please contact counter staff and present the Order UUID above for manual verification and refund or manual dispensing.
        </p>
        <button className="btn btn-secondary" onClick={onNewOrder}>
          Return to Snack Menu
        </button>
      </div>
    </div>
  );
};
