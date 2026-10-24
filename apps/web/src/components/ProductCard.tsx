import { useState } from "react";
import type { Product } from "../types";
import { formatPaise } from "../utils/format";
import { getProductMeta } from "../utils/productMeta";

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
  const [imageError, setImageError] = useState(false);
  const isOutOfStock = product.available_units <= 0;
  const canAddMore = cartQuantity < product.available_units;
  const meta = getProductMeta(product.name);

  return (
    <article
      className={`premium-product-card glow-${meta.glowColor} ${
        isOutOfStock ? "is-sold-out" : ""
      } ${cartQuantity > 0 ? "has-cart-items" : ""}`}
    >
      {/* Product Image Stage with Curated Photography */}
      <div className="product-media-frame">
        {!imageError ? (
          <img
            src={meta.imageUrl}
            alt={product.name}
            className="product-food-photo"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="product-visual-stage">
            <span className="product-icon-display">{meta.emoji}</span>
          </div>
        )}
        <div className="media-overlay-gradient"></div>

        {/* Floating Badges Over Image */}
        <div className="media-top-chips">
          <span className="card-category-badge">{meta.category}</span>
          <span className="card-tag-pill">{meta.tag}</span>
        </div>
      </div>

      <div className="card-content">
        <div className="card-header-group">
          <h3 className="card-product-title">{product.name}</h3>
          <p className="card-product-desc">{meta.description}</p>
        </div>

        <div className="card-meta-row">
          <div className="stock-meter">
            {isOutOfStock ? (
              <span className="stock-status-pill out-of-stock">
                <span className="stock-dot dot-red"></span> Sold Out
              </span>
            ) : product.available_units <= 3 ? (
              <span className="stock-status-pill low-stock">
                <span className="stock-dot dot-amber pulse-anim"></span> Only {product.available_units} left
              </span>
            ) : (
              <span className="stock-status-pill in-stock">
                <span className="stock-dot dot-green"></span> {product.available_units} in locker
              </span>
            )}
          </div>
        </div>

        <div className="card-purchase-row">
          <div className="price-tag-container">
            <span className="price-tag-sub">PRICE</span>
            <span className="price-tag-value">{formatPaise(product.price_paise)}</span>
          </div>

          <div className="card-action-wrapper">
            {cartQuantity === 0 ? (
              <button
                className="btn btn-add-cart"
                onClick={() => onAddToCart(product)}
                disabled={isOutOfStock}
                aria-label={`Add ${product.name} to cart for ${formatPaise(
                  product.price_paise,
                )}`}
              >
                {isOutOfStock ? (
                  "Sold Out"
                ) : (
                  <>
                    <span className="add-plus-icon">+</span>
                    <span>Add</span>
                  </>
                )}
              </button>
            ) : (
              <div
                className="card-stepper"
                role="group"
                aria-label={`Quantity selector for ${product.name}`}
              >
                <button
                  className="stepper-btn stepper-minus"
                  onClick={() => onUpdateQuantity(product.id, cartQuantity - 1)}
                  aria-label={`Decrease quantity of ${product.name}`}
                >
                  −
                </button>
                <span className="stepper-count" aria-live="polite">
                  {cartQuantity}
                </span>
                <button
                  className="stepper-btn stepper-plus"
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
      </div>
    </article>
  );
}
