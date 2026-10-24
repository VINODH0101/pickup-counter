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

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [productError, setProductError] = useState<string | null>(null);

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

  return (
    <div className="app-root">
      <Header
        cartItemCount={totalCartCount}
        onOpenCart={() => setIsCartOpen(true)}
        activeOrderActive={Boolean(activeOrder)}
        onViewOrder={() => setViewingOrderView(true)}
      />

      <main className="main-container">
        {/* Active Order View Overlay / Mode */}
        {viewingOrderView && activeOrder ? (
          <div className="active-order-screen">
            <button
              className="btn btn-secondary back-to-menu-btn"
              onClick={() => setViewingOrderView(false)}
            >
              ← Browse Menu
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
            <div className="catalog-header">
              <h2 className="catalog-title">Snack Selection</h2>
              <p className="catalog-subtitle">
                Select your favorite snacks. Prices and inventory are updated in real time from the locker counter.
              </p>
            </div>

            {productError && (
              <div className="alert alert-error" role="alert">
                <span>⚠️ {productError}</span>
                <button className="btn btn-secondary btn-small" onClick={loadProducts}>
                  Retry
                </button>
              </div>
            )}

            {isLoadingProducts ? (
              <div className="loading-state">
                <span className="spinner"></span>
                <p>Loading available snacks from locker counter...</p>
              </div>
            ) : (
              <div className="product-grid">
                {products.map((product) => {
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
export default App;
