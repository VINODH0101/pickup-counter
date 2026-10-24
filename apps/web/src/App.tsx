import { useEffect, useState } from "react";
import { createOrder, fetchOrder, fetchProducts } from "./api/client";
import { CartDrawer } from "./components/CartDrawer";
import { Header } from "./components/Header";
import { OrderExpiredView } from "./components/OrderExpiredView";
import { OrderNeedsReviewView } from "./components/OrderNeedsReviewView";
import { OrderPaidView } from "./components/OrderPaidView";
import { OrderPickedUpView } from "./components/OrderPickedUpView";
import { OrderPendingView } from "./components/OrderPendingView";
import { ProductCard } from "./components/ProductCard";
import { useOrderPolling } from "./hooks/useOrderPolling";
import "./styles.css";
import type { CartItem, Order, PickupClaimResult, Product } from "./types";
import { formatPaise } from "./utils/format";
import {
  getProductMeta,
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from "./utils/productMeta";

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [productError, setProductError] = useState<string | null>(null);

  // Filter & Search states
  const [selectedCategory, setSelectedCategory] =
    useState<ProductCategory>("All Items");
  const [searchQuery, setSearchQuery] = useState("");

  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [claimResult, setClaimResult] = useState<PickupClaimResult | null>(null);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [viewingOrderView, setViewingOrderView] = useState(false);

  // Hook for robust polling of active order status until paid, expired, or needs_review
  const {
    order: polledOrder,
    error: pollingError,
    setOrder: setPolledOrder,
  } = useOrderPolling(activeOrder?.id ?? null, activeOrder);

  // Synchronize polled order state with active order
  useEffect(() => {
    if (polledOrder) {
      setActiveOrder(polledOrder);
      // Refresh catalog in background when order status changes to keep available units accurate
      if (polledOrder.status !== "pending") {
        loadProducts();
      }
    }
  }, [polledOrder]);

  const loadProducts = async () => {
    try {
      setIsLoadingProducts(true);
      const data = await fetchProducts();
      setProducts(data);
      setProductError(null);
    } catch (err: any) {
      setProductError(err.message || "Failed to load snack menu.");
    } finally {
      setIsLoadingProducts(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  // Cart operations
  const handleAddToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.available_units) return prev;
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    setIsCartOpen(true);
  };

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((item) => item.product.id !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((item) => {
        if (item.product.id === productId) {
          const clampedQty = Math.min(quantity, item.product.available_units);
          return { ...item, quantity: clampedQty };
        }
        return item;
      }),
    );
  };

  const handleClearCart = () => {
    setCart([]);
    setOrderError(null);
  };

  // Submit order to POST /orders
  const handleCheckout = async () => {
    if (cart.length === 0) return;

    setIsSubmittingOrder(true);
    setOrderError(null);

    try {
      const itemsPayload = cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      }));

      const newOrder = await createOrder(itemsPayload);
      setActiveOrder(newOrder);
      setPolledOrder(newOrder);
      setClaimResult(null);
      setCart([]);
      setIsCartOpen(false);
      setViewingOrderView(true);

      // Refresh catalog to immediately reflect the 120-second hold
      loadProducts();
    } catch (err: any) {
      setOrderError(err.message || "Checkout failed.");
      // Refresh products to show updated inventory after conflict
      loadProducts();
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleManualRefreshOrder = async () => {
    if (!activeOrder) return;
    try {
      const updated = await fetchOrder(activeOrder.id);
      setActiveOrder(updated);
      setPolledOrder(updated);
    } catch (err) {
      console.error("Refresh order error:", err);
    }
  };

  const handleStartNewOrder = () => {
    setActiveOrder(null);
    setPolledOrder(null);
    setClaimResult(null);
    setViewingOrderView(false);
    loadProducts();
  };

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCartPaise = cart.reduce(
    (sum, item) => sum + item.product.price_paise * item.quantity,
    0,
  );

  // Filtered snacks based on active category & search query
  const filteredProducts = products.filter((product) => {
    const meta = getProductMeta(product.name);
    const matchesCategory =
      selectedCategory === "All Items" || meta.category === selectedCategory;

    const query = searchQuery.trim().toLowerCase();
    const matchesQuery =
      query === "" ||
      product.name.toLowerCase().includes(query) ||
      meta.description.toLowerCase().includes(query) ||
      meta.tag.toLowerCase().includes(query);

    return matchesCategory && matchesQuery;
  });

  const getCategoryCount = (category: ProductCategory) => {
    if (category === "All Items") return products.length;
    return products.filter((p) => getProductMeta(p.name).category === category).length;
  };

  return (
    <div className="app-root">
      <Header
        cartItemCount={totalCartCount}
        cartTotalPaise={totalCartPaise}
        onOpenCart={() => setIsCartOpen(true)}
        activeOrderActive={Boolean(activeOrder)}
        onViewOrder={() => setViewingOrderView(true)}
      />

      <main className="main-container">
        {/* Active Order View Overlay / Mode */}
        {viewingOrderView && activeOrder ? (
          <div className="active-order-screen">
            <button
              className="btn back-to-menu-btn"
              onClick={() => setViewingOrderView(false)}
            >
              ← Back to Snack Vault Menu
            </button>

            {activeOrder.status === "pending" && (
              <OrderPendingView
                order={activeOrder}
                onRefreshOrder={handleManualRefreshOrder}
                onCancelToCatalog={() => setViewingOrderView(false)}
                pollingError={pollingError}
              />
            )}

            {activeOrder.status === "paid" && (
              <OrderPaidView
                order={activeOrder}
                onClaimSuccess={(claim) => {
                  setClaimResult(claim);
                  setActiveOrder({ ...activeOrder, status: "picked_up" });
                  loadProducts();
                }}
                onOrderExpired={handleManualRefreshOrder}
              />
            )}

            {activeOrder.status === "picked_up" && (
              <OrderPickedUpView
                order={activeOrder}
                claimResult={claimResult}
                onNewOrder={handleStartNewOrder}
              />
            )}

            {activeOrder.status === "expired" && (
              <OrderExpiredView
                order={activeOrder}
                onNewOrder={handleStartNewOrder}
              />
            )}

            {activeOrder.status === "needs_review" && (
              <OrderNeedsReviewView
                order={activeOrder}
                onNewOrder={handleStartNewOrder}
              />
            )}
          </div>
        ) : (
          /* Catalog View */
          <div className="catalog-screen">
            {/* Hero Station Banner */}
            <section className="hero-station-banner">
              <div className="hero-content">
                <div className="hero-badge-row">
                  <span className="hero-tag">Station 01 • Express Locker</span>
                  <span className="station-badge">12 Curated Snacks</span>
                </div>
                <h2 className="hero-title">Gourmet Snacks On Demand</h2>
                <p className="hero-desc">
                  Select premium refreshments, reserve them with a guaranteed 120-second stock hold, and unlock your compartment instantly upon payment capture.
                </p>

                <div className="hero-guarantees">
                  <div className="guarantee-chip">
                    <span className="chip-icon">🔒</span>
                    <span>120s Hold Protection</span>
                  </div>
                  <div className="guarantee-chip">
                    <span className="chip-icon">⚡</span>
                    <span>Contactless Magnetic Door Unlock</span>
                  </div>
                  <div className="guarantee-chip">
                    <span className="chip-icon">🛡️</span>
                    <span>Zero Overselling Guarantee</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Catalog Controls: Search & Category Pills */}
            <div className="catalog-controls-bar">
              <div className="search-input-wrapper">
                <svg
                  className="search-icon-svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  className="catalog-search-input"
                  placeholder="Search snacks, beverages, chocolates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search snacks in catalog"
                />
                {searchQuery && (
                  <button
                    className="clear-search-btn"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search input"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="category-tabs-row" role="tablist" aria-label="Snack categories">
                {PRODUCT_CATEGORIES.map((cat) => {
                  const isActive = selectedCategory === cat;
                  const count = getCategoryCount(cat);
                  return (
                    <button
                      key={cat}
                      role="tab"
                      aria-selected={isActive}
                      className={`category-pill-btn ${isActive ? "is-active" : ""}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      <span>{cat}</span>
                      <span className="category-count-chip">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {productError && (
              <div className="alert alert-error" role="alert">
                <span>⚠️ {productError}</span>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={loadProducts}
                >
                  Retry Connection
                </button>
              </div>
            )}

            {isLoadingProducts ? (
              <div className="loading-state">
                <span className="spinner"></span>
                <p>Synchronizing available locker inventory with PostgreSQL...</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="no-results-stage">
                <span className="no-results-icon">🔍</span>
                <h3 className="no-results-title">No snacks matched your search</h3>
                <p className="no-results-sub">
                  Try adjusting your search query or select another category tab above.
                </p>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedCategory("All Items");
                  }}
                >
                  Reset Filter
                </button>
              </div>
            ) : (
              <div className="product-grid">
                {filteredProducts.map((product) => {
                  const cartItem = cart.find(
                    (item) => item.product.id === product.id,
                  );
                  return (
                    <ProductCard
                      key={product.id}
                      product={product}
                      cartQuantity={cartItem ? cartItem.quantity : 0}
                      onAddToCart={handleAddToCart}
                      onUpdateQuantity={handleUpdateQuantity}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Floating Bottom Quick Cart Summary */}
      {!viewingOrderView && totalCartCount > 0 && !isCartOpen && (
        <aside className="floating-cart-bar" aria-label="Quick cart bar">
          <div className="floating-cart-inner">
            <div className="floating-cart-info">
              <span className="floating-cart-pill">
                {totalCartCount} {totalCartCount === 1 ? "item" : "items"}
              </span>
              <span className="floating-cart-total">{formatPaise(totalCartPaise)}</span>
            </div>
            <button
              className="floating-checkout-btn"
              onClick={() => setIsCartOpen(true)}
            >
              View Locker Tray & Checkout →
            </button>
          </div>
        </aside>
      )}

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={cart}
        onUpdateQuantity={handleUpdateQuantity}
        onClearCart={handleClearCart}
        onCheckout={handleCheckout}
        isSubmitting={isSubmittingOrder}
        error={orderError}
      />
    </div>
  );
}
