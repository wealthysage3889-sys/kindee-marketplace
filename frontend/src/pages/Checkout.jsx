import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { orderAPI, storeAPI, productAPI } from "../api";
import { formatCurrency, formatThaiPhone, validateThaiPhone } from "../utils/helpers";
import "./Checkout.css";

const DEFAULT_CENTER = [13.7563, 100.5018]; // Bangkok
const DEFAULT_ZOOM = 13;

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng);
    }
  });
  return null;
}

function LocationPicker({ coordinates, onCoordinatesChange, onAddressChange }) {
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [address, setAddress] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  // Update map center when coordinates change
  useEffect(() => {
    if (mapRef.current && coordinates) {
      mapRef.current.setView([coordinates.lat, coordinates.lng], 16);
      if (markerRef.current) {
        markerRef.current.setLatLng([coordinates.lat, coordinates.lng]);
      }
    }
  }, [coordinates]);

  const handleMapPick = (latlng) => {
    const lat = Number(latlng.lat);
    const lng = Number(latlng.lng);
    onCoordinatesChange({ lat, lng });
    reverseGeocode(lat, lng);
  };

  const handleMarkerDragEnd = (e) => {
    const { lat, lng } = e.target.getLatLng();
    onCoordinatesChange({ lat, lng });
    reverseGeocode(lat, lng);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError("เบราว์เซอร์ไม่รองรับการระบุตำแหน่ง");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        onCoordinatesChange({ lat, lng });
        reverseGeocode(lat, lng);
        setLocating(false);
      },
      () => {
        setError("ไม่สามารถระบุตำแหน่งได้ กรุณาอนุญาตให้ใช้งาน GPS หรือเลือกบนแผนที่");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const reverseGeocode = async (lat, lng) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=th`
      );
      const data = await response.json();
      const formattedAddress = data.display_name || "";
      setAddress(formattedAddress);
      onAddressChange?.(formattedAddress);
    } catch (error) {
      console.error("Reverse geocode error:", error);
    }
  };

  const searchLocation = async () => {
    if (!searchQuery.trim()) return;
    
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&accept-language=th`
      );
      const data = await response.json();
      setSearchResults(data);
    } catch (error) {
      console.error("Search error:", error);
    }
  };

  const selectSearchResult = (result) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    onCoordinatesChange({ lat, lng });
    setAddress(result.display_name);
    onAddressChange?.(result.display_name);
    setSearchResults([]);
    setSearchQuery("");
    
    if (mapRef.current) {
      mapRef.current.leafletElement.setView([lat, lng], 16);
    }
  };

  return (
    <div className="location-picker">
      <div className="location-search">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && searchLocation()}
          placeholder="ค้นหาสถานที่..."
        />
        <button onClick={searchQuery.trim() && searchLocation}>ค้นหา</button>
      </div>

      {searchResults.length > 0 && (
        <div className="search-results">
          {searchResults.map((result, index) => (
            <div key={index} className="search-result-item" onClick={() => selectSearchResult(result)}>
              <strong>{result.display_name.split(",")[0]}</strong>
              <span>{result.display_name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="map-container">
        <MapContainer
          center={coordinates ? [coordinates.lat, coordinates.lng] : DEFAULT_CENTER}
          zoom={coordinates ? 16 : DEFAULT_ZOOM}
          scrollWheelZoom={true}
          ref={mapRef}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler onPick={handleMapPick} />
          {coordinates && (
            <Marker
              position={[coordinates.lat, coordinates.lng]}
              draggable={true}
              ref={markerRef}
              onDragEnd={handleMarkerDragEnd}
            >
              <Popup>
                <div>
                  <strong>ตำแหน่งจัดส่ง</strong>
                  <p>{address || `Lat: ${coordinates.lat.toFixed(6)}, Lng: ${coordinates.lng.toFixed(6)}`}</p>
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      <div className="location-actions">
        <button type="button" onClick={useMyLocation} disabled={locating}>
          {locating ? "กำลังระบุตำแหน่ง..." : "ใช้ตำแหน่งของฉัน (GPS)"}
        </button>
        {error && <span className="location-error">{error}</span>}
      </div>

      {coordinates && (
        <div className="selected-location">
          <label>ที่อยู่จัดส่ง:</label>
          <textarea
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              onAddressChange?.(e.target.value);
            }}
            rows={3}
            placeholder="รายละเอียดที่อยู่ (บ้านเลขที่ ซอย ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์)"
          />
          <p className="coordinates">
            พิกัด: {coordinates.lat.toFixed(6)}, {coordinates.lng.toFixed(6)}
          </p>
        </div>
      )}
    </div>
  );
}

export default function Checkout() {
  const { user, isAuthenticated } = useAuth();
  const { items, totalPrice, totalCount, clear } = useCart();
  const navigate = useNavigate();
  
  const [step, setStep] = useState(1); // 1: address, 2: payment, 3: confirm
  const [coordinates, setCoordinates] = useState(null);
  const [deliveryAddress, setDeliveryAddress] = useState({
    name: user?.name || "",
    phone: user?.phone || "",
    address: "",
    district: "",
    province: "",
    postalCode: ""
  });
  const [paymentMethod, setPaymentMethod] = useState("cod");
  const [customerNotes, setCustomerNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stores, setStores] = useState([]);
  const [storeDeliveryInfo, setStoreDeliveryInfo] = useState({});

  // Load store info for delivery fees
  useEffect(() => {
    const loadStoreInfo = async () => {
      const storeIds = [...new Set(items.map(item => item.storeId).filter(Boolean))];
      for (const storeId of storeIds) {
        try {
          const store = await storeAPI.getById(storeId);
          setStores(prev => [...prev, store.data]);
        } catch (error) {
          console.error("Failed to load store:", error);
        }
      }
    };
    loadStoreInfo();
  }, [items]);

  const calculateShipping = () => {
    let total = 0;
    stores.forEach(store => {
      const storeItems = items.filter(item => item.storeId === store.id);
      const subtotal = storeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      
      if (store.minimumOrder && subtotal < store.minimumOrder) {
        return;
      }
      total += store.deliveryFee || 0;
    });
    return total;
  };

  const handleAddressSubmit = (e) => {
    e.preventDefault();
    
    if (!coordinates) {
      setError("กรุณาเลือกตำแหน่งจัดส่งบนแผนที่");
      return;
    }
    
    if (!validateThaiPhone(deliveryAddress.phone)) {
      setError("กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง");
      return;
    }
    
    setStep(2);
    setError("");
  };

  const handlePaymentSubmit = (e) => {
    e.preventDefault();
    setStep(3);
  };

  const handleConfirmOrder = async () => {
    setLoading(true);
    setError("");
    
    try {
      // Prepare order items with store info
      const orderItems = items.map(item => ({
        productId: item.id,
        quantity: item.quantity
      }));
      
      // Format delivery address
      const formattedAddress = {
        name: deliveryAddress.name,
        phone: formatThaiPhone(deliveryAddress.phone),
        address: deliveryAddress.address,
        district: deliveryAddress.district,
        province: deliveryAddress.province,
        postalCode: deliveryAddress.postalCode
      };
      
      const result = await orderAPI.create({
        items: orderItems,
        paymentMethod,
        customerNotes,
        deliveryAddress: formattedAddress,
        customerCoordinates: coordinates
      });
      
      clear();
      navigate(`/order-success/${result.data.id}`);
    } catch (err) {
      setError(err.message || "เกิดข้อผิดพลาดในการสั่งซื้อ");
    } finally {
      setLoading(false);
    }
  };

  const shippingFee = calculateShipping();
  const taxAmount = totalPrice * 0.07;
  const totalAmount = totalPrice + shippingFee + taxAmount;

  if (!isAuthenticated) {
    return (
      <div className="checkout-container">
        <div className="checkout-auth-required">
          <h2>กรุณาเข้าสู่ระบบเพื่อสั่งซื้อ</h2>
          <p>คุณต้องเข้าสู่ระบบก่อนจะสามารถทำการสั่งซื้อได้</p>
          <button onClick={() => navigate("/login")}>เข้าสู่ระบบ</button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="checkout-container">
        <div className="empty-cart">
          <h2>ตะกร้าสินค้าว่างเปล่า</h2>
          <button onClick={() => navigate("/")}>กลับไปหน้าหลัก</button>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-container">
      <div className="checkout-progress">
        <div className={`step ${step >= 1 ? "active" : ""}`}>
          <span className="step-number">1</span>
          <span className="step-label">ที่อยู่จัดส่ง</span>
        </div>
        <div className={`step ${step >= 2 ? "active" : ""}`}>
          <span className="step-number">2</span>
          <span className="step-label">ชำระเงิน</span>
        </div>
        <div className={`step ${step >= 3 ? "active" : ""}`}>
          <span className="step-number">3</span>
          <span className="step-label">ยืนยัน</span>
        </div>
      </div>

      {step === 1 && (
        <form onSubmit={handleAddressSubmit} className="checkout-form">
          <div className="form-section">
            <h3>ข้อมูลผู้รับ</h3>
            <div className="form-row">
              <div className="form-group">
                <label>ชื่อ-นามสกุล *</label>
                <input
                  type="text"
                  value={deliveryAddress.name}
                  onChange={(e) => setDeliveryAddress({...deliveryAddress, name: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>เบอร์โทรศัพท์ *</label>
                <input
                  type="tel"
                  value={deliveryAddress.phone}
                  onChange={(e) => setDeliveryAddress({...deliveryAddress, phone: e.target.value})}
                  required
                  placeholder="08X-XXX-XXXX"
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>ตำแหน่งจัดส่ง</h3>
            <p className="map-instruction">คลิกที่แผนที่เพื่อเลือกตำแหน่ง หรือค้นหาสถานที่</p>
            <LocationPicker
              coordinates={coordinates}
              onCoordinatesChange={setCoordinates}
              onAddressChange={(addr) => setDeliveryAddress({...deliveryAddress, address: addr})}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="form-actions">
            <button type="submit" className="btn-primary">ถัดไป: ชำระเงิน</button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handlePaymentSubmit} className="checkout-form">
          <div className="form-section">
            <h3>เลือกวิธีชำระเงิน</h3>
            <div className="payment-options">
              <label className={`payment-option ${paymentMethod === "cod" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cod"
                  checked={paymentMethod === "cod"}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
                <div className="payment-option-content">
                  <span className="payment-icon">💵</span>
                  <div>
                    <strong>ชำระเงินปลายทาง (COD)</strong>
                    <p>จ่ายเงินสดเมื่อได้รับสินค้า</p>
                  </div>
                </div>
              </label>
              
              <label className={`payment-option ${paymentMethod === "promptpay" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="promptpay"
                  checked={paymentMethod === "promptpay"}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
                <div className="payment-option-content">
                  <span className="payment-icon">📱</span>
                  <div>
                    <strong>PromptPay</strong>
                    <p>สแกน QR Code เพื่อชำระเงิน</p>
                  </div>
                </div>
              </label>
              
              <label className={`payment-option ${paymentMethod === "transfer" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="transfer"
                  checked={paymentMethod === "transfer"}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
                <div className="payment-option-content">
                  <span className="payment-icon">🏦</span>
                  <div>
                    <strong>โอนเงินผ่านธนาคาร</strong>
                    <p>โอนเงินและส่งสลิปยืนยัน</p>
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="form-section">
            <h3>หมายเหตุเพิ่มเติม (ถ้ามี)</h3>
            <textarea
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              rows={3}
              placeholder="ข้อมูลเพิ่มเติมสำหรับผู้จัดส่ง..."
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>กลับ</button>
            <button type="submit" className="btn-primary">ถัดไป: ยืนยัน</button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="checkout-form">
          <div className="form-section">
            <h3>สรุปรายการสั่งซื้อ</h3>
            <div className="order-summary">
              {items.map(item => (
                <div key={item.id} className="order-item">
                  <img src={item.image} alt={item.name} />
                  <div className="item-details">
                    <span className="item-name">{item.name}</span>
                    <span className="item-qty">x {item.quantity}</span>
                  </div>
                  <span className="item-price">{formatCurrency(item.price * item.quantity)}</span>
                </div>
              ))}
              
              <div className="summary-row">
                <span>ราคาสินค้า</span>
                <span>{formatCurrency(totalPrice)}</span>
              </div>
              <div className="summary-row">
                <span>ค่าจัดส่ง</span>
                <span>{formatCurrency(shippingFee)}</span>
              </div>
              <div className="summary-row">
                <span>ภาษีมูลค่าเพิ่ม (7%)</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
              <div className="summary-row total">
                <span>รวมทั้งสิ้น</span>
                <span>{formatCurrency(totalAmount)}</span>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>ที่อยู่จัดส่ง</h3>
            <div className="address-summary">
              <p><strong>{deliveryAddress.name}</strong></p>
              <p>{formatThaiPhone(deliveryAddress.phone)}</p>
              <p>{deliveryAddress.address}</p>
              {coordinates && <p className="coordinates">พิกัด: {coordinates.lat.toFixed(6)}, {coordinates.lng.toFixed(6)}</p>}
            </div>
          </div>

          <div className="form-section">
            <h3>วิธีชำระเงิน</h3>
            <p>{paymentMethod === "cod" ? "ชำระเงินปลายทาง" : paymentMethod === "promptpay" ? "PromptPay" : "โอนเงินผ่านธนาคาร"}</p>
          </div>

          {customerNotes && (
            <div className="form-section">
              <h3>หมายเหตุ</h3>
              <p>{customerNotes}</p>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep(2)}>แก้ไข</button>
            <button 
              type="button" 
              className="btn-primary btn-large" 
              onClick={handleConfirmOrder}
              disabled={loading}
            >
              {loading ? "กำลังดำเนินการ..." : "ยืนยันสั่งซื้อ"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}