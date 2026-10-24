import { useState } from "react";
import { simulatePayment } from "../api/client";
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
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationMsg, setSimulationMsg] = useState<string | null>(null);

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

  const handleSimulateWebhook = async () => {
    setIsSimulating(true);
    setSimulationMsg(null);
    try {
      await simulatePayment(order.id, order.totalPaise, "captured");
      setSimulationMsg("Signed webhook dispatched! Awaiting poll confirmation...");
      onRefreshOrder();
    } catch (err: any) {
      setSimulationMsg(`Simulation error: ${err.message}`);
    } finally {
      setIsSimulating(false);
    }
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
              className="btn-copy-small"
              onClick={handleCopyOrderId}
              aria-label="Copy order ID"
            >
              {copiedOrderId ? "✓ Copied" : "Copy ID"}
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

      {/* Styled Simulated Payment Instruction & Developer Terminal */}
      <div className="payment-simulation-box">
        <div className="sim-box-header">
          <div className="sim-badge-group">
            <span className="sim-cli-icon">&gt;_</span>
            <h4 className="sim-heading">Simulated Payment Instruction</h4>
          </div>
          <span className="sim-security-badge">HMAC-SHA256 SIGNED</span>
        </div>

        <p className="sim-subtext">
          The backend only authorizes state transitions via verified
          HMAC-SHA256 signed webhooks. Run this simulator command in your
          terminal:
        </p>

        {/* Terminal Deck */}
        <div className="command-deck-container">
          <div className="terminal-top-bar">
            <div className="terminal-dots" aria-hidden="true">
              <span className="dot dot-red"></span>
              <span className="dot dot-yellow"></span>
              <span className="dot dot-green"></span>
            </div>
            <span className="terminal-title">bash — pickup-counter</span>
            <button
              className={`btn btn-copy-terminal ${copiedCommand ? "is-copied" : ""}`}
              onClick={handleCopyCommand}
              aria-label="Copy command to clipboard"
            >
              {copiedCommand ? (
                <>
                  <span className="copy-check">✓</span>
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span>Copy Command</span>
                </>
              )}
            </button>
          </div>

          <div className="terminal-body">
            <span className="terminal-prompt">$</span>
            <code className="terminal-command-text">
              <span className="cmd-keyword">npm run send-webhook</span> -- --order-id{" "}
              <span className="cmd-id">{order.id}</span>
            </code>
          </div>
        </div>

        {/* Quick Instant Test Trigger */}
        <div className="quick-sim-trigger-row">
          <span className="quick-sim-hint">Or test with one click in browser:</span>
          <button
            className="btn btn-quick-simulate"
            onClick={handleSimulateWebhook}
            disabled={isSimulating || isExpired}
          >
            {isSimulating ? (
              <span className="sim-btn-spinner">Dispatching...</span>
            ) : (
              <span>⚡ Send Signed Test Webhook</span>
            )}
          </button>
        </div>

        {simulationMsg && (
          <div className="simulation-feedback-alert">
            <span className="sim-feedback-icon">ℹ️</span>
            <span>{simulationMsg}</span>
          </div>
        )}
      </div>

      <div className="pending-actions">
        {isExpired ? (
          <button
            className="btn btn-primary btn-large btn-return-action"
            onClick={onCancelToCatalog}
          >
            Return to Menu & Re-order
          </button>
        ) : (
          <div className="pending-bottom-bar">
            <div className="polling-status-pill">
              <span className="status-live-beacon"></span>
              <span className="polling-text">
                Polling order status every 1.5s... (Will update immediately upon webhook capture)
              </span>
            </div>

            <button
              className="btn btn-back-catalog"
              onClick={onCancelToCatalog}
            >
              ← Back to Catalog
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
