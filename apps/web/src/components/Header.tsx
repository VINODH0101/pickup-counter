interface HeaderProps {
  cartItemCount: number;
  cartTotalPaise?: number;
  onOpenCart: () => void;
  activeOrderActive: boolean;
  onViewOrder?: () => void;
}

export function Header({
  cartItemCount,
  cartTotalPaise = 0,
  onOpenCart,
  activeOrderActive,
  onViewOrder,
}: HeaderProps) {
  const formattedTotal =
    cartTotalPaise > 0 ? `₹${(cartTotalPaise / 100).toFixed(2)}` : null;

  return (
    <header className="app-header">
      <div className="header-container">
        <div className="brand-group">
          <div className="brand-emblem" aria-hidden="true">
            <svg
              className="emblem-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
              <circle cx="6" cy="6" r="1" fill="currentColor" />
            </svg>
            <div className="emblem-glow"></div>
          </div>

          <div className="brand-text">
            <div className="brand-title-row">
              <h1 className="brand-title">SNACK VAULT</h1>
              <span className="station-badge">STATION 01</span>
            </div>
            <p className="brand-subtitle">Autonomous Contactless Pickup Counter</p>
          </div>
        </div>

        <div className="header-status-indicator">
          <span className="status-live-beacon"></span>
          <span className="status-live-text">LOCKER ONLINE</span>
        </div>

        <div className="header-actions">
          {activeOrderActive && onViewOrder && (
            <button
              className="btn btn-active-order"
              onClick={onViewOrder}
              aria-label="View active snack order hold"
            >
              <span className="pulse-order-beacon"></span>
              <span className="active-order-text">Active Order</span>
            </button>
          )}

          <button
            className={`btn btn-cart-toggle ${cartItemCount > 0 ? "has-items" : ""}`}
            onClick={onOpenCart}
            aria-label={`Shopping cart with ${cartItemCount} items`}
          >
            <span className="cart-icon" aria-hidden="true">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
            </span>
            <span className="cart-label">Cart</span>
            {cartItemCount > 0 && (
              <span className="cart-pill-badge">{cartItemCount}</span>
            )}
            {formattedTotal && (
              <span className="cart-total-preview">{formattedTotal}</span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
