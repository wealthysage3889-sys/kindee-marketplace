import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from "react-leaflet";
import { Icon } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { deliveryAPI, callAPI } from "../api";
import { formatCurrency, formatDate, formatRelativeTime, formatDuration, formatAddress } from "../utils/helpers";
import "./CourierDashboard.css";

const STATUS_LABELS = {
  pending: "รอรับงาน",
  assigned: "ได้รับมอบหมาย",
  picked_up: "รับสินค้าแล้ว",
  in_transit: "กำลังจัดส่ง",
  delivered: "จัดส่งสำเร็จ",
  failed: "ล้มเหลว",
  cancelled: "ยกเลิก"
};

const COURIER_ICON = new Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/3204/3204561.png",
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40]
});

const STORE_ICON = new Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/2965/2965597.png",
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36]
});

const CUSTOMER_ICON = new Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/1077/1077114.png",
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36]
});

export default function CourierDashboard() {
  const { user, logout } = useAuth();
  const { sendCourierLocation, on, off, connected } = useSocket();
  const navigate = useNavigate();
  
  const [deliveries, setDeliveries] = useState([]);
  const [activeDelivery, setActiveDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAvailable, setIsAvailable] = useState(true);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [watchId, setWatchId] = useState(null);
  const [activeTab, setActiveTab] = useState("assigned");
  const [mapCenter, setMapCenter] = useState([13.7563, 100.5018]);
  const [mapZoom, setMapZoom] = useState(13);

  // Load deliveries
  const loadDeliveries = useCallback(async () => {
    try {
      const data = await deliveryAPI.getMyDeliveries();
      setDeliveries(data.data);
      
      // Find active delivery
      const active = data.data.find(d => 
        ["assigned", "picked_up", "in_transit"].includes(d.status)
      );
      setActiveDelivery(active || null);
      
      if (active) {
        centerMapOnDelivery(active);
      }
    } catch (err) {
      setError(err.message || "ไม่สามารถโหลดงานจัดส่งได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeliveries();
  }, [loadDeliveries]);

  // Socket listeners
  useEffect(() => {
    const handleNewDelivery = () => {
      loadDeliveries();
    };
    
    const handleDeliveryUpdate = (data) => {
      setDeliveries(prev => prev.map(d => 
        d.id === data.deliveryId ? { ...d, status: data.status, ...data } : d
      ));
      
      if (activeDelivery && activeDelivery.id === data.deliveryId) {
        setActiveDelivery(prev => prev ? { ...prev, ...data } : null);
      }
    };
    
    const handleCourierLocation = (data) => {
      // Update other couriers' locations if needed
    };
    
    on("newDelivery", handleNewDelivery);
    on("deliveryStatusUpdate", handleDeliveryUpdate);
    on("courierLocationUpdate", handleCourierLocation);
    
    return () => {
      off("newDelivery", handleNewDelivery);
      off("deliveryStatusUpdate", handleDeliveryUpdate);
      off("courierLocationUpdate", handleCourierLocation);
    };
  }, [on, off, loadDeliveries, activeDelivery]);

  // GPS Tracking
  const startLocationTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError("เบราว์เซอร์ไม่รองรับ GPS");
      return;
    }
    
    const id = navigator.geolocation.watchPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed ? position.coords.speed * 3.6 : null, // m/s to km/h
          heading: position.coords.heading
        };
        
        setCurrentLocation(coords);
        
        // Send to server if active delivery
        if (activeDelivery) {
          sendCourierLocation(activeDelivery.id, coords, {
            accuracy: coords.accuracy,
            speed: coords.speed,
            heading: coords.heading
          });
        }
      },
      (err) => {
        console.error("GPS error:", err);
        setError("ไม่สามารถเข้าถึง GPS ได้");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 10000
      }
    );
    
    setWatchId(id);
  }, [activeDelivery, sendCourierLocation]);

  const stopLocationTracking = useCallback(() => {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
    }
  }, [watchId]);

  useEffect(() => {
    if (isAvailable && activeDelivery) {
      startLocationTracking();
    } else {
      stopLocationTracking();
    }
    
    return () => stopLocationTracking();
  }, [isAvailable, activeDelivery, startLocationTracking, stopLocationTracking]);

  // Toggle availability
  const toggleAvailability = async () => {
    try {
      if (isAvailable) {
        await deliveryAPI.endShift();
        setIsAvailable(false);
        stopLocationTracking();
      } else {
        setIsAvailable(true);
      }
    } catch (err) {
      setError(err.message || "ไม่สามารถเปลี่ยนสถานะได้");
    }
  };

  // Accept assignment
  const handleAccept = async (assignmentId) => {
    try {
      await deliveryAPI.acceptAssignment(assignmentId);
      loadDeliveries();
    } catch (err) {
      setError(err.message || "ไม่สามารถรับงานได้");
    }
  };

  // Reject assignment
  const handleReject = async (assignmentId) => {
    try {
      await deliveryAPI.rejectAssignment(assignmentId);
      loadDeliveries();
    } catch (err) {
      setError(err.message || "ไม่สามารถปฏิเสธงานได้");
    }
  };

  // Pickup order
  const handlePickup = async (deliveryId) => {
    try {
      await deliveryAPI.pickup(deliveryId);
      loadDeliveries();
    } catch (err) {
      setError(err.message || "ไม่สามารถรับสินค้าได้");
    }
  };

  // Deliver order
  const handleDeliver = async (deliveryId) => {
    try {
      await deliveryAPI.deliver(deliveryId);
      loadDeliveries();
    } catch (err) {
      setError(err.message || "ไม่สามารถจัดส่งสำเร็จได้");
    }
  };

  // Center map on delivery
  const centerMapOnDelivery = (delivery) => {
    if (delivery.pickup_coordinates && delivery.delivery_coordinates) {
      const midLat = (delivery.pickup_coordinates.coordinates[1] + delivery.delivery_coordinates.coordinates[1]) / 2;
      const midLng = (delivery.pickup_coordinates.coordinates[0] + delivery.delivery_coordinates.coordinates[0]) / 2;
      setMapCenter([midLat, midLng]);
      setMapZoom(13);
    } else if (delivery.pickup_coordinates) {
      setMapCenter([
        delivery.pickup_coordinates.coordinates[1],
        delivery.pickup_coordinates.coordinates[0]
      ]);
      setMapZoom(15);
    }
  };

  // Get assignments for pending deliveries
  const getAssignments = (delivery) => {
    // This would come from the API
    return delivery.assignments || [];
  };

  if (loading) {
    return (
      <div className="courier-dashboard">
        <div className="loading">กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div className="courier-dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <h1>แดชบอร์ดผู้จัดส่ง</h1>
          <span className={`status-indicator ${isAvailable ? "available" : "unavailable"}`}>
            {isAvailable ? "พร้อมรับงาน" : "ออฟไลน์"}
          </span>
        </div>
        <div className="header-right">
          <button className={`btn-toggle ${isAvailable ? "on" : "off"}`} onClick={toggleAvailability}>
            {isAvailable ? "ออฟไลน์" : "ออนไลน์"}
          </button>
          <button className="btn-logout" onClick={() => logout("customer")}>ออกจากระบบ</button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="dashboard-tabs">
        <button className={activeTab === "assigned" ? "active" : ""} onClick={() => setActiveTab("assigned")}>
          งานที่ได้รับมอบหมาย
          <span className="tab-badge">
            {deliveries.filter(d => ["assigned", "picked_up", "in_transit"].includes(d.status)).length}
          </span>
        </button>
        <button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>
          ประวัติ
          <span className="tab-badge">{deliveries.filter(d => ["delivered", "failed", "cancelled"].includes(d.status)).length}</span>
        </button>
        <button className={activeTab === "earnings" ? "active" : ""} onClick={() => setActiveTab("earnings")}>
          รายได้
        </button>
      </div>

      {activeTab === "assigned" && (
        <div className="tab-content">
          {activeDelivery ? (
            <ActiveDeliveryCard
              delivery={activeDelivery}
              currentLocation={currentLocation}
              onPickup={handlePickup}
              onDeliver={handleDeliver}
              onCenterMap={centerMapOnDelivery}
              formatAddress={formatAddress}
            />
          ) : (
            <div className="no-active-delivery">
              <div className="empty-icon">🛵</div>
              <h3>ไม่มีงานจัดส่งที่กำลังดำเนินการ</h3>
              <p>งานใหม่จะปรากฏที่นี่เมื่อมีลูกค้าสั่งซื้อ</p>
            </div>
          )}

          <div className="pending-assignments">
            <h3>งานรอรับมอบหมาย</h3>
            {deliveries
              .filter(d => d.status === "pending" && d.assignments?.some(a => a.status === "offered"))
              .map(delivery => (
                <AssignmentCard
                  key={delivery.id}
                  delivery={delivery}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  formatAddress={formatAddress}
                />
              ))}
            {deliveries.filter(d => d.status === "pending" && d.assignments?.some(a => a.status === "offered")).length === 0 && (
              <p className="no-pending">ไม่มีงานรอรับมอบหมาย</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div className="tab-content">
          <div className="history-filters">
            <select className="filter-select" defaultValue="">
              <option value="">ทุกสถานะ</option>
              <option value="delivered">จัดส่งสำเร็จ</option>
              <option value="failed">ล้มเหลว</option>
              <option value="cancelled">ยกเลิก</option>
            </select>
          </div>
          
          <div className="history-list">
            {deliveries
              .filter(d => ["delivered", "failed", "cancelled"].includes(d.status))
              .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
              .map(delivery => (
                <HistoryItem key={delivery.id} delivery={delivery} formatDate={formatDate} formatAddress={formatAddress} />
              ))}
            {deliveries.filter(d => ["delivered", "failed", "cancelled"].includes(d.status)).length === 0 && (
              <div className="empty-state">
                <p>ยังไม่มีประวัติการจัดส่ง</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "earnings" && (
        <div className="tab-content earnings-tab">
          <EarningsSummary deliveries={deliveries} formatCurrency={formatCurrency} />
        </div>
      )}

      {/* Map for active delivery */}
      {activeDelivery && activeTab === "assigned" && (
        <div className="map-panel">
          <div className="map-header">
            <h3>แผนที่จัดส่ง</h3>
            <button className="btn-minimize" onClick={() => setActiveDelivery(null)}>−</button>
          </div>
          <div className="map-container-courier">
            <MapContainer
              center={mapCenter}
              zoom={mapZoom}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              
              {/* Store (pickup) */}
              {activeDelivery.pickup_coordinates && (
                <Marker
                  position={[
                    activeDelivery.pickup_coordinates.coordinates[1],
                    activeDelivery.pickup_coordinates.coordinates[0]
                  ]}
                  icon={STORE_ICON}
                >
                  <Popup>
                    <strong>จุดรับสินค้า</strong>
                    <p>{activeDelivery.store_order?.store?.name}</p>
                    <p>{formatAddress(activeDelivery.pickup_address)}</p>
                  </Popup>
                </Marker>
              )}
              
              {/* Customer (delivery) */}
              {activeDelivery.delivery_coordinates && (
                <Marker
                  position={[
                    activeDelivery.delivery_coordinates.coordinates[1],
                    activeDelivery.delivery_coordinates.coordinates[0]
                  ]}
                  icon={CUSTOMER_ICON}
                >
                  <Popup>
                    <strong>จุดส่งสินค้า</strong>
                    <p>{activeDelivery.store_order?.order?.customer_snapshot?.name}</p>
                    <p>{formatAddress(activeDelivery.delivery_address)}</p>
                  </Popup>
                </Marker>
              )}
              
              {/* Route */}
              {activeDelivery.route_geometry && (
                <Polyline
                  positions={activeDelivery.route_geometry.coordinates.map(([lng, lat]) => [lat, lng])}
                  color="#2196f3"
                  weight={4}
                  opacity={0.8}
                />
              )}
              
              {/* Courier location */}
              {currentLocation && (
                <Marker
                  position={[currentLocation.lat, currentLocation.lng]}
                  icon={COURIER_ICON}
                >
                  <Popup>
                    <strong>คุณ (ผู้จัดส่ง)</strong>
                    <p>ตำแหน่งปัจจุบัน</p>
                    {currentLocation.accuracy && <p>ความแม่นยำ: ±{Math.round(currentLocation.accuracy)}ม.</p>}
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveDeliveryCard({ delivery, currentLocation, onPickup, onDeliver, onCenterMap, formatAddress }) {
  const statusColors = {
    assigned: "#2196f3",
    picked_up: "#ff9800",
    in_transit: "#2196f3",
    delivered: "#4caf50"
  };

  return (
    <div className="active-delivery-card" style={{ borderLeftColor: statusColors[delivery.status] }}>
      <div className="delivery-header">
        <div>
          <h3>ออเดอร์ #{delivery.store_order?.store_order_number}</h3>
          <p>{delivery.store_order?.store?.name}</p>
        </div>
        <span className={`status-badge status-${delivery.status}`} style={{ background: statusColors[delivery.status] }}>
          {STATUS_LABELS[delivery.status]}
        </span>
      </div>

      <div className="delivery-info-grid">
        <div className="info-item">
          <label>🏪 จุดรับ</label>
          <value>{delivery.store_order?.store?.name}</value>
          <small>{formatAddress(delivery.pickup_address)}</small>
        </div>
        <div className="info-item">
          <label>🏠 จุดส่ง</label>
          <value>{delivery.store_order?.order?.customer_snapshot?.name}</value>
          <small>{formatAddress(delivery.delivery_address)}</small>
        </div>
        <div className="info-item">
          <label>💰 ยอดออเดอร์</label>
          <value>{formatCurrency(delivery.store_order?.total_amount || 0)}</value>
        </div>
        <div className="info-item">
          <label>📦 สินค้า</label>
          <value>{delivery.store_order?.order_items?.length || 0} รายการ</value>
        </div>
      </div>

      <div className="delivery-actions">
        {delivery.status === "assigned" && (
          <button className="btn-primary" onClick={() => onPickup(delivery.id)}>
            รับสินค้า
          </button>
        )}
        {(delivery.status === "picked_up" || delivery.status === "in_transit") && (
          <button className="btn-success" onClick={() => onDeliver(delivery.id)}>
            จัดส่งสำเร็จ
          </button>
        )}
        <button className="btn-map" onClick={() => onCenterMap(delivery)}>
          📍 ดูบนแผนที่
        </button>
      </div>

      {currentLocation && (
        <div className="current-location">
          <small>📍 ตำแหน่งปัจจุบัน: {currentLocation.lat.toFixed(6)}, {currentLocation.lng.toFixed(6)}</small>
        </div>
      )}
    </div>
  );
}

function AssignmentCard({ delivery, onAccept, onReject, formatAddress }) {
  const assignment = delivery.assignments?.find(a => a.status === "offered");
  const expiresAt = assignment ? new Date(assignment.expires_at) : null;
  const timeLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : 0;

  return (
    <div className="assignment-card">
      <div className="assignment-info">
        <h4>ออเดอร์ #{delivery.store_order_number}</h4>
        <p>{delivery.store?.name}</p>
        <p>{formatAddress(delivery.pickup_address)} → {formatAddress(delivery.delivery_address)}</p>
        <span className="assignment-timer">⏱ {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}</span>
      </div>
      <div className="assignment-actions">
        <button className="btn-reject" onClick={() => onReject(assignment.id)}>ปฏิเสธ</button>
        <button className="btn-accept" onClick={() => onAccept(assignment.id)}>รับงาน</button>
      </div>
    </div>
  );
}

function HistoryItem({ delivery, formatDate, formatAddress }) {
  const statusColors = {
    delivered: "#4caf50",
    failed: "#f44336",
    cancelled: "#9e9e9e"
  };

  return (
    <div className="history-item" style={{ borderLeftColor: statusColors[delivery.status] }}>
      <div className="history-header">
        <span>ออเดอร์ #{delivery.store_order_number}</span>
        <span className={`status-badge status-${delivery.status}`} style={{ background: statusColors[delivery.status] }}>
          {STATUS_LABELS[delivery.status]}
        </span>
      </div>
      <div className="history-details">
        <p>{delivery.store?.name}</p>
        <p>📍 {formatAddress(delivery.pickup_address)} → {formatAddress(delivery.delivery_address)}</p>
        <p>💰 {formatCurrency(delivery.total_amount)}</p>
        <p>🕐 {formatDate(delivery.updated_at)}</p>
      </div>
    </div>
  );
}

function EarningsSummary({ deliveries, formatCurrency }) {
  const completedDeliveries = deliveries.filter(d => d.status === "delivered");
  const totalEarnings = completedDeliveries.reduce((sum, d) => sum + (d.courier_fee || 0), 0);
  const thisMonth = completedDeliveries.filter(d => {
    const date = new Date(d.delivered_at);
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });
  const monthlyEarnings = thisMonth.reduce((sum, d) => sum + (d.courier_fee || 0), 0);

  return (
    <div className="earnings-grid">
      <div className="earnings-card total">
        <h3>รายได้ทั้งหมด</h3>
        <div className="earnings-amount">{formatCurrency(totalEarnings)}</div>
        <p>{completedDeliveries.length} งาน</p>
      </div>
      <div className="earnings-card monthly">
        <h3>รายได้เดือนนี้</h3>
        <div className="earnings-amount">{formatCurrency(monthlyEarnings)}</div>
        <p>{thisMonth.length} งาน</p>
      </div>
      <div className="earnings-card avg">
        <h3>เฉลี่ยต่องาน</h3>
        <div className="earnings-amount">
          {completedDeliveries.length > 0 
            ? formatCurrency(totalEarnings / completedDeliveries.length) 
            : "0"}
        </div>
        <p>ต่อการจัดส่ง</p>
      </div>
      
      <div className="earnings-breakdown">
        <h3>รายละเอียดรายได้</h3>
        <table className="earnings-table">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>ออเดอร์</th>
              <th>ค่าจัดส่ง</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {completedDeliveries.slice(0, 20).map(d => (
              <tr key={d.id}>
                <td>{formatDate(d.delivered_at)}</td>
                <td>#{d.store_order_number}</td>
                <td>{formatCurrency(d.courier_fee || 0)}</td>
                <td><span className="status-delivered">✅ สำเร็จ</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}