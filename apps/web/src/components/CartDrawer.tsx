import type { CartItem } from "../types";
import { formatPaise } from "../utils/format";

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

  return (
    <div className="cart-backdrop" onClick={onClose} role="presentation">
      <div
        className="cart-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="cart-title"
        aria-modal="true"
      >
        <div className="cart-header">
          <h2 id="cart-title">Your Snack Cart</h2>
          <button
            className="close-btn"
            onClick={onClose}
            aria-label="Close cart"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            <span className="alert-icon">⚠️</span>
            <div className="alert-body">
              <strong>Order Failed:</strong> {error}
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="cart-empty">
            <span className="empty-emoji">🛒</span>
            <p>Your cart is empty.</p>
            <button className="btn btn-secondary" onClick={onClose}>
              Browse Snacks
            </button>
          </div>
        ) : (
          <>
            <div className="cart-items-list">
              {items.map(({ product, quantity }) => {
                const itemTotal = product.price_paise * quantity;
                return (
                  <div key={product.id} className="cart-item-row">
                    <div className="cart-item-details">
                      <h3 className="cart-item-name">{product.name}</h3>
                      <span className="cart-item-unit-price">
                        {formatPaise(product.price_paise)} each
                      </span>
                    </div>

                    <div className="cart-item-actions">
                      <div className="quantity-controls" role="group" aria-label={`Quantity controls for ${product.name}`}>
                        <button
                          className="qty-btn"
                          onClick={() => onUpdateQuantity(product.id, quantity - 1)}
                          aria-label={`Decrease quantity of ${product.name}`}
                        >
                          −
                        </button>
                        <span className="qty-value">{quantity}</span>
                        <button
                          className="qty-btn"
                          onClick={() => onUpdateQuantity(product.id, quantity + 1)}
                          disabled={quantity >= product.available_units}
                          aria-label={`Increase quantity of ${product.name}`}
                        >
                          +
                        </button>
                      </div>

                      <span className="cart-item-subtotal">
                        {formatPaise(itemTotal)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="cart-footer">
              <div className="cart-summary-row">
                <span className="summary-label">Estimated Total:</span>
                <span className="summary-total">{formatPaise(totalPaise)}</span>
              </div>
              <p className="summary-note">
                Final total and a 120-second stock hold will be confirmed by the server upon checkout.
              </p>

              <div className="cart-action-buttons">
                <button
                  className="btn btn-secondary clear-btn"
                  onClick={onClearCart}
                  disabled={isSubmitting}
                >
                  Clear
                </button>
                <button
                  className="btn btn-primary checkout-btn"
                  onClick={onCheckout}
                  disabled={isSubmitting || items.length === 0}
                >
                  {isSubmitting ? (
                    <>
                      <span className="spinner"></span> Reserving...
                    </>
                  ) : (
                    `Reserve & Pay (${formatPaise(totalPaise)})`
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
