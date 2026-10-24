import { useState } from "react";
import { useOrderCountdown } from "../hooks/useOrderCountdown";
import type { Order } from "../types";
import { formatPaise, formatSeconds } from "../utils/format";

interface OrderPendingViewProps {
  order: Order;
  onRefreshOrder: () => void;
  onCancelToCatalog: () => void;
  pollingError: string | null;
}

export function OrderPendingView({
  order,
  onRefreshOrder,
  onCancelToCatalog,
  pollingError,
}: OrderPendingViewProps) {
  const [copiedOrderId, setCopiedOrderId] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  // Accurate monotonic countdown using performance.now()
  const secondsLeft = useOrderCountdown(order.expiresInSeconds, onRefreshOrder);
  const isExpired = secondsLeft <= 0;
  const isUrgent = secondsLeft <= 30 && !isExpired;

  const webhookCommand = `npm run send-webhook -- --order-id ${order.id}`;

  const handleCopyOrderId = () => {
    navigator.clipboard.writeText(order.id);
    setCopiedOrderId(true);
    setTimeout(() => setCopiedOrderId(false), 2000);
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(webhookCommand);
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  return (
    <div
      className={`order-view-card pending-card ${isExpired ? "expired-border" : ""}`}
      role="region"
      aria-labelledby="pending-heading"
    >
      <div className="status-header">
        <span
          className={`status-badge ${
            isExpired ? "badge-expired" : "badge-pending"
          }`}
        >
          {isExpired ? "Hold Expired" : "Payment Pending"}
        </span>

        <div
          className={`countdown-container ${
            isUrgent ? "countdown-urgent" : ""
          } ${isExpired ? "countdown-expired" : ""}`}
          aria-live="polite"
        >
          <span className="countdown-label">
            {isExpired ? "Status:" : "Hold Expires In:"}
          </span>
          <span className="countdown-timer">
            {isExpired ? "00:00" : formatSeconds(secondsLeft)}
          </span>
        </div>
      </div>

      <h2 id="pending-heading" className="order-title">
        {isExpired ? "Hold Time Expired" : "Payment Awaiting Confirmation"}
      </h2>

      {isExpired ? (
        <div className="alert alert-error" role="alert">
          <span>
            ⚠️ <strong>Reservation Expired:</strong> The 120-second stock hold
            has elapsed. Unpaid reserved snacks have been automatically released
            back to the counter catalog.
          </span>
        </div>
      ) : (
        <p className="order-lead">
          Snacks are reserved in the counter locker. Complete payment before the
          hold expires.
        </p>
      )}

      {pollingError && (
        <div className="alert alert-warning" role="alert">
          <span>⚠️ {pollingError}</span>
        </div>
      )}

      <div className="order-details-box">
        <div className="detail-row">
          <span className="detail-key">Order UUID:</span>
          <div className="copy-row">
            <code className="detail-code">{order.id}</code>
            <button
              className="btn btn-secondary btn-small copy-btn"
              onClick={handleCopyOrderId}
              aria-label="Copy order ID"
            >
              {copiedOrderId ? "Copied!" : "Copy ID"}
            </button>
          </div>
        </div>

        <div className="detail-row">
          <span className="detail-key">Authoritative Total:</span>
          <strong className="detail-total">{formatPaise(order.totalPaise)}</strong>
        </div>

        <div className="detail-row">
          <span className="detail-key">PostgreSQL Clock Hold:</span>
          <span>120 seconds</span>
        </div>
      </div>

      <div className="order-items-summary">
        <h3>Reserved Items</h3>
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

      {/* Simulated Payment Instruction (No frontend button marking order paid!) */}
      <div className="payment-simulation-box">
        <div className="simulation-info">
          <h4>Simulated Payment Instruction</h4>
          <p>
            The backend only authorizes state transitions via verified
            HMAC-SHA256 signed webhooks. Run this simulator command in your
            terminal:
          </p>
        </div>

        <div className="command-box">
          <code className="terminal-command">{webhookCommand}</code>
          <button
            className="btn btn-secondary btn-small copy-btn"
            onClick={handleCopyCommand}
            aria-label="Copy webhook terminal command"
          >
            {copiedCommand ? "Copied!" : "Copy Command"}
          </button>
        </div>
      </div>

      <div className="pending-actions">
        {isExpired ? (
          <button
            className="btn btn-primary btn-large"
            onClick={onCancelToCatalog}
          >
            Return to Menu & Re-order
          </button>
        ) : (
          <>
            <div className="polling-status-footer">
              <span className="pulse-indicator"></span>
              <span className="polling-text">
                Polling order status every 1.5s... (Will update immediately upon
                webhook capture)
              </span>
            </div>
            <button
              className="btn btn-secondary cancel-link"
              onClick={onCancelToCatalog}
            >
              Back to Catalog
            </button>
          </>
        )}
      </div>
    </div>
  );
}
