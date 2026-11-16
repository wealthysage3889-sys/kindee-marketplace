import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);
const STORAGE_KEY = "cart";
const PLACEHOLDER_IMAGE = "https://via.placeholder.com/600x600?text=No+Image";

function readCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// Mirrors backend utils/productPricing.js#resolveEffectivePrice so the cart
// total and the amount the backend charges can never disagree.
//   NULL/"" -> regular price, 0 -> regular price (free items are not supported),
//   0 < d < price -> discount price, d >= price -> regular price.
function resolvePrice(product) {
  const price = Number(product.price);
  const rawDiscount = product.discount_price ?? product.discountPrice;
  const discount =
    rawDiscount === null || rawDiscount === undefined || rawDiscount === ""
      ? null
      : Number(rawDiscount);

  if (!Number.isFinite(price)) return 0;
  if (discount === null || !Number.isFinite(discount)) return price;
  if (discount <= 0 || discount >= price) return price;
  return discount;
}

function resolveProductId(product) {
  return product.id ?? product._id;
}

function resolveImage(product) {
  return product.images?.[0] || PLACEHOLDER_IMAGE;
}

function resolveStock(product) {
  const stock = product.stock;
  return stock != null && stock !== "" ? Number(stock) : null;
}

function resolveSellerName(product) {
  if (!product.seller) return "";
  return typeof product.seller === "object" ? product.seller?.name || "" : "";
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within CartProvider");
  }
  return ctx;
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(readCart);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      /* ignore storage errors */
    }
  }, [items]);

  const addItem = useCallback((product, quantity = 1) => {
    const qty = Math.max(1, Number(quantity) || 1);
    const productId = resolveProductId(product);
    setItems((prev) => {
      const existing = prev.find((item) => item.id === productId);
      if (existing) {
        const max = existing.stock != null ? existing.stock : Infinity;
        return prev.map((item) =>
          item.id === productId
            ? { ...item, quantity: Math.min(item.quantity + qty, max) }
            : item
        );
      }
      const stock = resolveStock(product);
      const max = stock != null ? stock : Infinity;
      const storeId = product.store_id || product.store?._id || product.store?.id || null;
      const storeName = product.store?.name || product.storeName || "";
      return [
        ...prev,
        {
          id: productId,
          name: product.name,
          price: resolvePrice(product),
          image: resolveImage(product),
          sellerName: resolveSellerName(product) || storeName,
          storeId,
          stock,
          quantity: Math.min(qty, max),
        },
      ];
    });
  }, []);

  const updateQuantity = useCallback((id, quantity) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const max = item.stock != null ? item.stock : Infinity;
        const next = Math.min(Math.max(1, Number(quantity) || 1), max);
        return { ...item, quantity: next };
      })
    );
  }, []);

  const removeItem = useCallback((id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const totalCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );

  const totalPrice = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items]
  );

  const value = {
    items,
    addItem,
    updateQuantity,
    removeItem,
    clear,
    totalCount,
    totalPrice,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}