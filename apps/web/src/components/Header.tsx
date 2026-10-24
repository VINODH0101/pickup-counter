interface HeaderProps {
  cartItemCount: number;
  onOpenCart: () => void;
  activeOrderActive: boolean;
  onViewOrder?: () => void;
}

export function Header({
  cartItemCount,
  onOpenCart,
  activeOrderActive,
  onViewOrder,
}: HeaderProps) {
  return (
    <header className="app-header">
      <div className="header-container">
        <div className="brand">
          <span className="brand-icon">🍿</span>
          <div>
            <h1 className="brand-title">Pickup Counter</h1>
            <p className="brand-subtitle">Self-Service Snack Lockers</p>
          </div>
        </div>

        <div className="header-actions">
          {activeOrderActive && onViewOrder && (
            <button
              className="btn btn-secondary active-order-btn"
              onClick={onViewOrder}
              aria-label="View active order status"
            >
              <span className="pulse-dot"></span>
              Active Order
            </button>
          )}

          <button
            className="btn btn-primary cart-toggle-btn"
            onClick={onOpenCart}
            aria-label={`Shopping cart with ${cartItemCount} items`}
          >
            <span>🛒 Cart</span>
            {cartItemCount > 0 && (
              <span className="cart-badge">{cartItemCount}</span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
