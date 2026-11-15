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

function resolvePrice(product) {
  const price = product.discountPrice ?? product.price;
  return Number(price) || 0;
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
    setItems((prev) => {
      const existing = prev.find((item) => item.id === product._id);
      if (existing) {
        const max = existing.stock != null ? existing.stock : Infinity;
        return prev.map((item) =>
          item.id === product._id
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
          id: product._id,
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