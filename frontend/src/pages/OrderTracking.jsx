import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { orderAPI, deliveryAPI } from "../api";
import { formatCurrency, formatDate, formatRelativeTime, formatAddress } from "../utils/helpers";
import "./OrderTracking.css";

const STATUS_LABELS = {
  pending: "รอดำเนินการ",
  confirmed: "ยืนยันแล้ว",
  preparing: "กำลังเตรียม",
  ready_for_pickup: "พร้อมรับสินค้า",
  picked_up: "รับสินค้าแล้ว",
  in_transit: "กำลังจัดส่ง",
  delivered: "จัดส่งสำเร็จ",
  cancelled: "ยกเลิก",
  refunded: "คืนเงิน"
};

const STATUS_ORDER = [
  "pending",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "in_transit",
  "delivered"
];

export default function OrderTracking() {
  const { id: orderId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { on, off } = useSocket();
  
  const [order, setOrder] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("summary");
const [mapCenter, setMapCenter] = useState([13.7563, 100.5018]);
const [mapZoom, setMapZoom] = useState(13);
const [slipFile, setSlipFile] = useState(null);
const [slipAmount, setSlipAmount] = useState("");
const [slipNote, setSlipNote] = useState("");
const [slipUploading, setSlipUploading] = useState(false);
const [slipError, setSlipError] = useState("");

  const loadOrder = useCallback(async () => {
    try {
      const result = await orderAPI.getById(orderId);
      setOrder(result.data);
      
      // Load delivery if exists
      if (result.data.store_orders?.[0]?.delivery) {
        setDelivery(result.data.store_orders[0].delivery);
        
        // Center map on delivery route
        const coords = result.data.store_orders[0].delivery;
        if (coords.pickup_coordinates && coords.delivery_coordinates) {
          const midLat = (coords.pickup_coordinates.coordinates[1] + coords.delivery_coordinates.coordinates[1]) / 2;
          const midLng = (coords.pickup_coordinates.coordinates[0] + coords.delivery_coordinates.coordinates[0]) / 2;
          setMapCenter([midLat, midLng]);
          setMapZoom(13);
        }
      }
    } catch (err) {
      setError(err.message || "ไม่พบคำสั่งซื้อ");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const handleSlipUpload = async (e) => {
    e.preventDefault();
    if (!slipFile) {
      setSlipError("กรุณาเลือกไฟล์สลิป");
      return;
    }
    setSlipUploading(true);
    setSlipError("");
    try {
      await orderAPI.uploadPaymentSlip(orderId, slipFile, slipAmount || null, slipNote || null);
      setSlipFile(null);
      setSlipAmount("");
      setSlipNote("");
      await loadOrder();
    } catch (err) {
      setSlipError(err.message || "อัปโหลดสลิปไม่สำเร็จ");
    } finally {
      setSlipUploading(false);
    }
  };

  // Realtime: refresh order when status changes
  useEffect(() => {
    const onOrderStatusUpdate = (data) => {
      if (!data || data.order_id === orderId || data.store_order_id) {
        loadOrder();
      }
    };
    on("orderStatusUpdate", onOrderStatusUpdate);
    return () => off("orderStatusUpdate", onOrderStatusUpdate);
  }, [on, off, orderId, loadOrder]);

  const getCurrentStatusIndex = () => {
    if (!order) return 0;
    return STATUS_ORDER.indexOf(order.status);
  };

  const isStatusCompleted = (status) => {
    const currentIndex = getCurrentStatusIndex();
    const statusIndex = STATUS_ORDER.indexOf(status);
    return statusIndex <= currentIndex && currentIndex !== -1;
  };

  const isStatusCurrent = (status) => {
    return order?.status === status;
  };

  const getCourierLocation = () => {
    if (!delivery?.live_locations?.length) return null;
    const latest = delivery.live_locations[0];
    return {
      lat: latest.coordinates.coordinates[1],
      lng: latest.coordinates.coordinates[0],
      timestamp: latest.created_at
    };
  };

  if (loading) {
    return (
      <div className="order-tracking-container">
        <div className="loading">กำลังโหลดข้อมูล...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="order-tracking-container">
        <div className="error">{error}</div>
      </div>
    );
  }

  const courierLocation = getCourierLocation();

  return (
    <div className="order-tracking-container">
      <div className="tracking-header">
        <div className="order-info">
          <h1>คำสั่งซื้อ #{order.order_number}</h1>
          <div className="order-meta">
            <span>สั่งเมื่อ: {formatDate(order.created_at)}</span>
            <span className={`status-badge status-${order.status}`}>
              {STATUS_LABELS[order.status] || order.status}
            </span>
          </div>
        </div>
        <div className="order-total">
          {formatCurrency(order.total_amount)}
        </div>
      </div>

      <div className="tracking-tabs">
        <button className={activeTab === "summary" ? "active" : ""} onClick={() => setActiveTab("summary")}>
          สรุปออเดอร์
        </button>
        <button className={activeTab === "tracking" ? "active" : ""} onClick={() => setActiveTab("tracking")}>
          ติดตามการจัดส่ง
        </button>
        <button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>
          ประวัติสถานะ
        </button>
      </div>

      {activeTab === "summary" && (
        <div className="tab-content">
          <div className="summary-grid">
            <div className="summary-card">
              <h3>สินค้าในออเดอร์</h3>
              {order.store_orders?.map(storeOrder => (
                <div key={storeOrder.id} className="store-order-section">
                  <h4>{storeOrder.store_snapshot?.name || "ร้านค้า"}</h4>
                  {storeOrder.order_items?.map(item => (
                    <div key={item.id} className="order-item">
                      <img src={item.product_image} alt={item.product_name} />
                      <div className="item-info">
                        <span className="item-name">{item.product_name}</span>
                        <span className="item-qty">x {item.quantity}</span>
                      </div>
                      <span className="item-price">{formatCurrency(item.total_price)}</span>
                    </div>
                  ))}
                  <div className="store-order-total">
                    <span>รวม: {formatCurrency(storeOrder.total_amount)}</span>
                    <span className={`status-badge status-${storeOrder.status}`}>
                      {STATUS_LABELS[storeOrder.status] || storeOrder.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="summary-card">
              <h3>ที่อยู่จัดส่ง</h3>
              <div className="address-card">
                <p><strong>{order.customer_snapshot?.name}</strong></p>
                <p>{order.customer_snapshot?.phone}</p>
                <p>{formatAddress(order.customer_snapshot?.address)}</p>
              </div>

              <h3 style={{ marginTop: 20 }}>สรุปยอดชำระ</h3>
              <div className="payment-summary">
                <div className="summary-row">
                  <span>ราคาสินค้า</span>
                  <span>{formatCurrency(order.subtotal)}</span>
                </div>
                <div className="summary-row">
                  <span>ค่าจัดส่ง</span>
                  <span>{formatCurrency(order.shipping_fee)}</span>
                </div>
                <div className="summary-row">
                  <span>ภาษีมูลค่าเพิ่ม ({order.vat_rate ?? 7}%)</span>
                  <span>{formatCurrency(order.tax_amount)}</span>
                </div>
                {order.discount_amount > 0 && (
                  <div className="summary-row discount">
                    <span>ส่วนลด</span>
                    <span>-{formatCurrency(order.discount_amount)}</span>
                  </div>
                )}
                <div className="summary-row total">
                  <span>รวมทั้งสิ้น</span>
                  <span>{formatCurrency(order.total_amount)}</span>
                </div>
              </div>

              <h3 style={{ marginTop: 20 }}>วิธีชำระเงิน</h3>
              <p className="payment-method">
                {order.payment_method === "cod" ? "ชำระเงินปลายทาง" : 
                 order.payment_method === "promptpay" ? "PromptPay" : "โอนเงิน"}
              </p>
              <span className={`payment-status status-${order.payment_status}`}>
                {order.payment_status === "paid" ? "ชำระแล้ว" : 
                 order.payment_status === "pending" ? "รอชำระ" : "ล้มเหลว"}
              </span>

              {order.payment_status === "pending" && order.payment_method !== "cod" && (
                <div className="slip-upload-section">
                  {order.payment_slips && order.payment_slips.length > 0 ? (
                    <div className="slip-status">
                      <h3 style={{ marginTop: 20 }}>สลิปการชำระเงิน</h3>
                      <p>ไฟล์: {order.payment_slips[0].slip_filename}</p>
                      <p>จำนวนเงิน: {formatCurrency(order.payment_slips[0].amount_thb)} THB</p>
                      <span className={`slip-status-badge status-${order.payment_slips[0].slip_status}`}>
                        {order.payment_slips[0].slip_status === "uploaded" ? "รอการตรวจสอบ" :
                         order.payment_slips[0].slip_status === "approved" ? "อนุมัติแล้ว" :
                         order.payment_slips[0].slip_status === "rejected" ? "ปฏิเสธแล้ว" : order.payment_slips[0].slip_status}
                      </span>
                      {order.payment_slips[0].slip_status === "rejected" && order.payment_slips[0].reject_reason && (
                        <p className="slip-reject-reason">สาเหตุ: {order.payment_slips[0].reject_reason}</p>
                      )}
                      {order.payment_slips[0].slip_status === "rejected" && (
                        <button onClick={() => setSlipFile(null)} className="btn-secondary">
                          อัปโหลดใหม่
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="slip-upload-form">
                      <h3 style={{ marginTop: 20 }}>อัปโหลดสลิปการชำระเงิน</h3>
                      <p>อัปโหลดรูปภาพหรือไฟล์ PDF ของสลิปการโอนเงิน</p>
                      {slipError && <div className="slip-error">{slipError}</div>}
                      <label className="slip-file-label">
                        <input type="file" accept="image/*,application/pdf" onChange={(e) => setSlipFile(e.target.files?.[0])} />
                        {slipFile ? slipFile.name : "เลือกไฟล์สลิป"}
                      </label>
                      <div className="slip-form-row">
                        <input
                          type="number"
                          placeholder="จำนวนเงิน (THB)"
                          value={slipAmount}
                          onChange={(e) => setSlipAmount(e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="หมายเหตุ (ถ้ามี)"
                          value={slipNote}
                          onChange={(e) => setSlipNote(e.target.value)}
                        />
                      </div>
                      <button onClick={handleSlipUpload} disabled={slipUploading} className="btn-primary">
                        {slipUploading ? "กำลังอัปโหลด..." : "อัปโหลดสลิป"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "tracking" && delivery && (
        <div className="tab-content tracking-content">
          <div className="tracking-header-info">
            <div className="delivery-status">
              <h3>สถานะการจัดส่ง</h3>
              <span className={`status-badge status-${delivery.status}`}>
                {STATUS_LABELS[delivery.status] || delivery.status}
              </span>
            </div>
            
            {courierLocation && (
              <div className="courier-info">
                <h4>ผู้จัดส่ง</h4>
                <p>{delivery.courier?.profile?.name}</p>
                <p>อัปเดตล่าสุด: {formatRelativeTime(courierLocation.timestamp)}</p>
              </div>
            )}
          </div>

          <div className="map-container-tracking">
            <MapContainer
              center={mapCenter}
              zoom={mapZoom}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              
              {/* Pickup location */}
              {delivery.pickup_coordinates && (
                <Marker position={[
                  delivery.pickup_coordinates.coordinates[1],
                  delivery.pickup_coordinates.coordinates[0]
                ]}>
                  <Popup>
                    <strong>จุดรับสินค้า</strong>
                    <p>{formatAddress(delivery.pickup_address)}</p>
                  </Popup>
                </Marker>
              )}
              
              {/* Delivery location */}
              {delivery.delivery_coordinates && (
                <Marker position={[
                  delivery.delivery_coordinates.coordinates[1],
                  delivery.delivery_coordinates.coordinates[0]
                ]}>
                  <Popup>
                    <strong>จุดส่งสินค้า</strong>
                    <p>{formatAddress(delivery.delivery_address)}</p>
                  </Popup>
                </Marker>
              )}
              
              {/* Route */}
              {delivery.route_geometry && (
                <Polyline
                  positions={delivery.route_geometry.coordinates.map(([lng, lat]) => [lat, lng])}
                  color="#2196f3"
                  weight={4}
                  opacity={0.8}
                />
              )}
              
              {/* Courier live location */}
              {courierLocation && (
                <Marker position={[courierLocation.lat, courierLocation.lng]} icon={courierIcon}>
                  <Popup>
                    <strong>ผู้จัดส่ง</strong>
                    <p>ตำแหน่งปัจจุบัน</p>
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          </div>

          {delivery.store_order && (
            <div className="delivery-timeline">
              <h3>ขั้นตอนการจัดส่ง</h3>
              <div className="timeline">
                {[
                  { key: "assigned", label: "มอบหมายให้ผู้จัดส่ง", time: delivery.assigned_at },
                  { key: "picked_up", label: "รับสินค้าแล้ว", time: delivery.picked_up_at },
                  { key: "in_transit", label: "กำลังจัดส่ง", time: delivery.store_order.picked_up_at },
                  { key: "delivered", label: "จัดส่งสำเร็จ", time: delivery.delivered_at }
                ].map((step, index) => (
                  <div key={step.key} className={`timeline-item ${isStatusCompleted(step.key) ? "completed" : ""} ${isStatusCurrent(step.key) ? "current" : ""}`}>
                    <div className="timeline-marker" />
                    <div className="timeline-content">
                      <span className="timeline-label">{step.label}</span>
                      {step.time && <span className="timeline-time">{formatDate(step.time)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="tab-content">
          <div className="history-list">
            {order.store_orders?.flatMap(storeOrder => [
              { type: "parent", label: "คำสั่งซื้อหลัก", history: order.store_orders?.[0]?.order_status_history },
              { type: "store", label: `ร้าน: ${storeOrder.store_snapshot?.name}`, history: storeOrder.order_status_history }
            ]).filter(item => item.history?.length).map((item, index) => (
              <div key={index} className="history-section">
                <h4>{item.label}</h4>
                {item.history?.map((h, i) => (
                  <div key={i} className="history-item">
                    <div className="history-status">
                      <span className={`status-dot status-${h.to_status}`} />
                      <span>{STATUS_LABELS[h.to_status] || h.to_status}</span>
                    </div>
                    <div className="history-meta">
                      <span>{formatDate(h.created_at)}</span>
                      {h.changed_by_user && <span>โดย {h.changed_by_user.name} ({h.changed_by_user.role})</span>}
                      {h.reason && <span className="history-reason">{h.reason}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tracking-actions">
        {activeTab !== "summary" && (
          <button onClick={() => setActiveTab("summary")} className="btn-secondary">
            กลับสู่สรุปออเดอร์
          </button>
        )}
        <button onClick={() => navigate("/orders")} className="btn-primary">
          ดูออเดอร์ทั้งหมด
        </button>
      </div>
    </div>
  );
}

// Custom courier icon
const courierIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/3204/3204561.png",
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40]
});