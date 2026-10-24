import type { CartItem } from "../types";
import { formatPaise } from "../utils/format";
import { getProductMeta } from "../utils/productMeta";

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onClearCart: () => void;
  onCheckout: () => void;
  isSubmitting: boolean;
  error: string | null;
}

export function CartDrawer({
  isOpen,
  onClose,
  items,
  onUpdateQuantity,
  onClearCart,
  onCheckout,
  isSubmitting,
  error,
}: CartDrawerProps) {
  if (!isOpen) return null;

  const totalPaise = items.reduce(
    (sum, item) => sum + item.product.price_paise * item.quantity,
    0,
  );
  const totalItemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="cart-backdrop" onClick={onClose} role="presentation">
      <div
        className="premium-cart-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="cart-title"
        aria-modal="true"
      >
        <div className="cart-drawer-header">
          <div className="cart-drawer-title-group">
            <h2 id="cart-title" className="cart-heading">Your Locker Cart</h2>
            <span className="cart-item-count-chip">{totalItemCount} items</span>
          </div>
          <button
            className="drawer-close-btn"
            onClick={onClose}
            aria-label="Close cart panel"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="cart-error-banner" role="alert">
            <span className="error-icon">⚠️</span>
            <div className="error-text">
              <strong>Reservation Error:</strong> {error}
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="cart-empty-stage">
            <div className="empty-cart-halo">
              <span className="empty-cart-icon">🛒</span>
            </div>
            <h3 className="empty-title">Your locker tray is empty</h3>
            <p className="empty-sub">
              Browse the snack selection and add your favorites to reserve them in the locker counter.
            </p>
            <button className="btn btn-browse-action" onClick={onClose}>
              Browse Snack Vault
            </button>
          </div>
        ) : (
          <>
            <div className="cart-items-scrollable">
              {items.map(({ product, quantity }) => {
                const itemTotal = product.price_paise * quantity;
                const meta = getProductMeta(product.name);
                const canAddMore = quantity < product.available_units;

                return (
                  <div key={product.id} className="cart-item-card">
                    <div className="cart-item-thumb">
                      <img
                        src={meta.imageUrl}
                        alt={product.name}
                        className="cart-thumb-img"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          if (e.currentTarget.nextElementSibling) {
                            (e.currentTarget.nextElementSibling as HTMLElement).style.display = "block";
                          }
                        }}
                      />
                      <span className="cart-item-emoji fallback-emoji" style={{ display: "none" }}>
                        {meta.emoji}
                      </span>
                    </div>

                    <div className="cart-item-info">
                      <div className="cart-item-header">
                        <h4 className="cart-item-name">{product.name}</h4>
                        <span className="cart-item-line-total">
                          {formatPaise(itemTotal)}
                        </span>
                      </div>

                      <div className="cart-item-meta">
                        <span className="cart-item-unit-cost">
                          {formatPaise(product.price_paise)} each
                        </span>
                        <span className="cart-item-locker-limit">
                          ({product.available_units} in locker)
                        </span>
                      </div>

                      <div className="cart-item-stepper-wrap">
                        <div
                          className="cart-stepper"
                          role="group"
                          aria-label={`Quantity selector for ${product.name}`}
                        >
                          <button
                            className="stepper-btn stepper-minus"
                            onClick={() =>
                              onUpdateQuantity(product.id, quantity - 1)
                            }
                            aria-label={`Decrease quantity of ${product.name}`}
                          >
                            −
                          </button>
                          <span className="stepper-qty" aria-live="polite">
                            {quantity}
                          </span>
                          <button
                            className="stepper-btn stepper-plus"
                            onClick={() =>
                              onUpdateQuantity(product.id, quantity + 1)
                            }
                            disabled={!canAddMore}
                            aria-label={`Increase quantity of ${product.name}`}
                          >
                            +
                          </button>
                        </div>

                        {quantity >= product.available_units && (
                          <span className="max-stock-notice">Locker limit reached</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="cart-drawer-footer">
              <div className="checkout-summary-box">
                <div className="summary-line">
                  <span className="summary-text">Subtotal</span>
                  <span className="summary-num">{formatPaise(totalPaise)}</span>
                </div>
                <div className="summary-line">
                  <span className="summary-text">Contactless Locker Dispense</span>
                  <span className="summary-badge-free">COMPLIMENTARY</span>
                </div>
                <div className="summary-line">
                  <span className="summary-text">Stock Hold Reservation</span>
                  <span className="summary-val">120 Seconds Guaranteed</span>
                </div>
                <div className="summary-divider"></div>
                <div className="summary-line summary-grand-total">
                  <span className="total-label">Estimated Total</span>
                  <span className="total-amount">{formatPaise(totalPaise)}</span>
                </div>
              </div>

              <div className="drawer-actions-row">
                <button
                  className="btn btn-clear-cart"
                  onClick={onClearCart}
                  disabled={isSubmitting}
                >
                  Clear Tray
                </button>
                <button
                  className="btn btn-primary btn-checkout-action"
                  onClick={onCheckout}
                  disabled={isSubmitting || items.length === 0}
                >
                  {isSubmitting ? (
                    <span className="checkout-spinner-wrap">
                      <span className="spinner-beacon"></span> Reserving Locker...
                    </span>
                  ) : (
                    <span>Reserve & Checkout • {formatPaise(totalPaise)}</span>
                  )}
                </button>
              </div>

              <p className="footer-disclaimer">
                🔒 PostgreSQL transactional row lock secures your hold immediately upon checkout.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
