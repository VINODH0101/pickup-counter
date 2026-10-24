import type { Product } from "../types";
import { formatPaise } from "../utils/format";

interface ProductCardProps {
  product: Product;
  cartQuantity: number;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
}

export function ProductCard({
  product,
  cartQuantity,
  onAddToCart,
  onUpdateQuantity,
}: ProductCardProps) {
  const isOutOfStock = product.available_units <= 0;
  const canAddMore = cartQuantity < product.available_units;

  // Visual emoji mapped to snack names
  const getEmoji = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes("water")) return "💧";
    if (lower.includes("chip")) return "🥔";
    if (lower.includes("choc")) return "🍫";
    if (lower.includes("cook")) return "🍪";
    if (lower.includes("juice")) return "🧃";
    return "🥨";
  };

  return (
    <article className={`product-card ${isOutOfStock ? "out-of-stock" : ""}`}>
      <div className="product-media" aria-hidden="true">
        <span className="product-emoji">{getEmoji(product.name)}</span>
      </div>

      <div className="product-info">
        <div className="product-header">
          <h2 className="product-name">{product.name}</h2>
          <span className="product-price">{formatPaise(product.price_paise)}</span>
        </div>

        <div className="stock-status-row">
          {isOutOfStock ? (
            <span className="stock-badge badge-empty">Out of Stock</span>
          ) : (
            <span
              className={`stock-badge ${
                product.available_units <= 3 ? "badge-low" : "badge-available"
              }`}
            >
              {product.available_units} available in locker
            </span>
          )}
        </div>

        <div className="product-actions">
          {cartQuantity === 0 ? (
            <button
              className="btn btn-primary add-btn"
              onClick={() => onAddToCart(product)}
              disabled={isOutOfStock}
              aria-label={`Add ${product.name} to cart for ${formatPaise(
                product.price_paise,
              )}`}
            >
              {isOutOfStock ? "Sold Out" : "Add to Cart"}
            </button>
          ) : (
            <div className="quantity-controls" role="group" aria-label={`Quantity controls for ${product.name}`}>
              <button
                className="qty-btn"
                onClick={() => onUpdateQuantity(product.id, cartQuantity - 1)}
                aria-label={`Decrease quantity of ${product.name}`}
              >
                −
              </button>
              <span className="qty-value" aria-live="polite">
                {cartQuantity}
              </span>
              <button
                className="qty-btn"
                onClick={() => onUpdateQuantity(product.id, cartQuantity + 1)}
                disabled={!canAddMore}
                aria-label={`Increase quantity of ${product.name}`}
              >
                +
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
};
