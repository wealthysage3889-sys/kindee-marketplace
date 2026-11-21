import Checkout from "../pages/Checkout";
import "./CheckoutModal.css";

export default function CheckoutModal({ open, onClose, orderSummary }) {
  if (!open) return null;
  return (
    <div className="checkout-modal-overlay" onClick={onClose}>
      <div className="checkout-modal-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="checkout-modal-close" onClick={onClose} aria-label="close">
          ×
        </button>
        <Checkout orderSummary={orderSummary} />
      </div>
    </div>
  );
}