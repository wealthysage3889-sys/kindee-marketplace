import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { chatAPI } from "../api";

const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const storeIcon = L.divIcon({
  className: "chat-route-pin",
  html: '<span class="chat-route-pin-dot store"></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -14],
});

const customerIcon = L.divIcon({
  className: "chat-route-pin",
  html: '<span class="chat-route-pin-dot customer"></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -14],
});

const ipIcon = L.divIcon({
  className: "chat-route-pin",
  html: '<span class="chat-route-pin-dot ip"></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -14],
});

const isValidLatLng = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180 &&
  !(lat === 0 && lng === 0);

// Mirrors backend/services/routeService.js parseCoordinates so the panel only
// ever uses coordinates that were actually stored in the conversation/order.
export function parseCoordinates(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const match = value.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
    if (!match) return null;
    const lng = Number(match[1]);
    const lat = Number(match[2]);
    return isValidLatLng(lat, lng) ? { lat, lng } : null;
  }

  if (Array.isArray(value)) {
    const [lng, lat] = value.map(Number);
    return isValidLatLng(lat, lng) ? { lat, lng } : null;
  }

  if (typeof value === "object") {
    if (value.type === "Point" && Array.isArray(value.coordinates)) {
      return parseCoordinates(value.coordinates);
    }
    const hasLat = value.lat !== undefined || value.latitude !== undefined || value.y !== undefined;
    const hasLng =
      value.lng !== undefined || value.lon !== undefined || value.longitude !== undefined || value.x !== undefined;
    if (!hasLat || !hasLng) return null;
    const lat = Number(value.lat ?? value.latitude ?? value.y);
    const lng = Number(value.lng ?? value.lon ?? value.longitude ?? value.x);
    return isValidLatLng(lat, lng) ? { lat, lng } : null;
  }

  return null;
}

export function coordinatesFromMessage(message) {
  if (!message || message.type !== "location") return null;
  const metadata = message.metadata || {};
  return (
    parseCoordinates(metadata.location) ||
    parseCoordinates(metadata.coordinates) ||
    parseCoordinates(metadata) ||
    (metadata.lat !== undefined || metadata.latitude !== undefined
      ? parseCoordinates({ lat: metadata.lat ?? metadata.latitude, lng: metadata.lng ?? metadata.longitude })
      : null)
  );
}

const haversineMeters = (a, b) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
};

const formatDistance = (meters) => {
  if (!Number.isFinite(meters) || meters < 0) return null;
  if (meters < 1000) return `${meters} ม.`;
  return `${Math.round(meters / 100) / 10} กม.`;
};

const formatTime = (iso) => {
  try {
    return new Date(iso).toLocaleString("th-TH", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const IP_REASON_TEXT = {
  disabled: "ปิดใช้งาน: ยังไม่ได้รับการอนุมัติ privacy policy สำหรับการระบุตำแหน่งจาก IP",
  no_recent_customer_location: "ยังไม่มีข้อมูล IP ล่าสุดจากลูกค้าในห้องแชทนี้",
  private_or_reserved_ip: "IP ของลูกค้าเป็นหมายเลขภายใน (VPN/NAT) จึงระบุตำแหน่งไม่ได้",
  provider_not_configured: "ยังไม่ได้ตั้งค่าผู้ให้บริการระบุตำแหน่งจาก IP",
  provider_not_supported: "ยังไม่ได้ตั้งค่าผู้ให้บริการระบุตำแหน่งจาก IP",
  provider_error: "ผู้ให้บริการระบุตำแหน่งจาก IP ขัดข้อง",
  provider_no_data: "ผู้ให้บริการไม่มีข้อมูลตำแหน่งสำหรับ IP นี้",
  missing_ip: "ไม่พบ IP ของลูกค้าสำหรับการประมาณตำแหน่ง",
  no_customer_in_conversation: "ไม่พบข้อมูลลูกค้าในบทสนทนานี้",
};

function FitBounds({ points }) {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15);
      return;
    }
    map.fitBounds(
      L.latLngBounds(points.map((p) => [p.lat, p.lng])),
      { padding: [40, 40] }
    );
  }, [map, points]);

  return null;
}

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const PinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

export default function ChatRoutePanel({ conversationId, mode = "admin", messages = [], currentUserId, onClose }) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [routeError, setRouteError] = useState("");
  const [ipLocation, setIpLocation] = useState(null);
  const [ipLoading, setIpLoading] = useState(true);
  const [ipError, setIpError] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  // Once the owner picks a target, new incoming messages must not silently
  // reset their choice.
  const userPickedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRouteError("");
    setRoute(null);
    chatAPI
      .getRoute(conversationId, mode)
      .then((res) => {
        if (!cancelled) setRoute(res?.data || res || null);
      })
      .catch((err) => {
        if (!cancelled) setRouteError(err.message || "ไม่สามารถโหลดข้อมูลเส้นทางได้");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, mode]);

  // Approximate, IP-based location is fetched independently from the GPS route.
  useEffect(() => {
    let cancelled = false;
    setIpLoading(true);
    setIpError("");
    setIpLocation(null);
    chatAPI
      .getIpLocation(conversationId, mode)
      .then((res) => {
        if (!cancelled) setIpLocation(res?.data || res || null);
      })
      .catch((err) => {
        if (!cancelled) setIpError(err.message || "ไม่สามารถโหลดตำแหน่งโดยประมาณจาก IP ได้");
      })
      .finally(() => {
        if (!cancelled) setIpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, mode]);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Lock background scrolling while the floating panel is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Only locations the *customer* actually shared as Location messages in this
  // conversation. Messages from the owner side and plain text are ignored.
  const sharedLocations = useMemo(() => {
    const list = [];
    const seen = new Set();
    [...messages].forEach((message) => {
      const senderId = message?.sender_id ?? message?.senderId ?? message?.sender?.id ?? message?.sender?._id;
      if (currentUserId && senderId && String(senderId) === String(currentUserId)) return;
      const coords = coordinatesFromMessage(message);
      if (!coords) return;
      const key = `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const metadata = message.metadata || {};
      const createdAt = message.created_at ?? message.createdAt;
      list.push({
        key: `chat-${message.id ?? message._id ?? key}`,
        role: "customer",
        source: "chat_location",
        lat: coords.lat,
        lng: coords.lng,
        label:
          metadata.label ||
          metadata.place_name ||
          message.content ||
          "ตำแหน่งที่ลูกค้าแชร์ในแชท",
        address: metadata.address || "",
        createdAt,
      });
    });
    return list;
  }, [messages, currentUserId]);

  const orderDestination = useMemo(() => {
    const destination = route?.destination;
    if (!destination) return null;
    if (destination.source !== "order_gps" && destination.source !== "order_address") return null;
    const coords = parseCoordinates(destination);
    if (!coords) return null;
    return {
      key: "order-destination",
      role: "order",
      source: destination.source,
      lat: coords.lat,
      lng: coords.lng,
      label: destination.label || "จุดส่งสินค้าจากคำสั่งซื้อ",
      address: destination.address || "",
      verified: destination.verified === true,
      orderNumber: route?.order_number || null,
    };
  }, [route]);

  const origin = useMemo(() => {
    const coords = parseCoordinates(route?.origin);
    if (!coords) return null;
    return {
      lat: coords.lat,
      lng: coords.lng,
      label: route?.origin?.label || route?.store?.name || "ร้านค้า",
      address: route?.origin?.address || "",
    };
  }, [route]);

  // GPS/shared targets only. IP location is intentionally NOT part of this list
  // so it can never become the automatic delivery destination or route target.
  const gpsTargets = useMemo(() => {
    const list = [];
    if (orderDestination) list.push(orderDestination);
    list.push(...sharedLocations);
    return list;
  }, [orderDestination, sharedLocations]);

  const ipTarget = useMemo(() => {
    if (!ipLocation?.available) return null;
    const coords = parseCoordinates({ lat: ipLocation.latitude, lng: ipLocation.longitude });
    if (!coords) return null;
    return {
      key: "ip-approximate",
      role: "ip",
      source: "ip",
      lat: coords.lat,
      lng: coords.lng,
      label:
        [ipLocation.city, ipLocation.region, ipLocation.country].filter(Boolean).join(", ") ||
        "ตำแหน่งโดยประมาณจาก IP",
      accuracyRadiusKm: Number.isFinite(Number(ipLocation.accuracy_radius_km))
        ? Number(ipLocation.accuracy_radius_km)
        : null,
      observedAt: ipLocation.observed_at || null,
      provider: ipLocation.provider || null,
      isVpn: ipLocation.is_vpn === true,
      isProxy: ipLocation.is_proxy === true,
      isHosting: ipLocation.is_hosting === true,
    };
  }, [ipLocation]);

  useEffect(() => {
    if (gpsTargets.length === 0) {
      // Never auto-pick the IP target, but keep an explicit IP selection.
      setSelectedKey((current) => (userPickedRef.current && current === "ip-approximate" ? current : ""));
      return;
    }
    setSelectedKey((current) => {
      if (
        userPickedRef.current &&
        current &&
        (current === "ip-approximate" || gpsTargets.some((t) => t.key === current))
      ) {
        return current;
      }
      // Prefer the order's verified delivery point when one exists.
      if (orderDestination) return orderDestination.key;
      return gpsTargets[0].key;
    });
  }, [gpsTargets, orderDestination]);

  const selectedTarget =
    gpsTargets.find((t) => t.key === selectedKey) ||
    (ipTarget && ipTarget.key === selectedKey ? ipTarget : null) ||
    null;
  const selectedIsIp = selectedTarget?.role === "ip";
  const selectedGpsTarget = selectedIsIp ? null : selectedTarget;

  const mapPoints = useMemo(
    () => [origin, selectedTarget].filter(Boolean),
    [origin, selectedTarget]
  );

  const distanceMeters =
    origin && selectedGpsTarget ? haversineMeters(origin, selectedGpsTarget) : null;

  const googleMapsUrl = useMemo(() => {
    if (!selectedGpsTarget) return null;
    const destination = `${selectedGpsTarget.lat},${selectedGpsTarget.lng}`;
    if (origin) {
      return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination}&travelmode=driving`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${destination}`;
  }, [origin, selectedGpsTarget]);

  const sourceLabel = (target) => {
    if (target.role === "order") return "จุดส่งสินค้า (จากคำสั่งซื้อ)";
    if (target.role === "ip") return "ตำแหน่งโดยประมาณจาก IP";
    return "ตำแหน่งลูกค้า (แชร์ในแชท)";
  };

  const selectTarget = (key) => {
    userPickedRef.current = true;
    setSelectedKey(key);
  };

  return createPortal(
    <div className="chat-route-backdrop" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose?.();
    }}>
      <aside className="chat-route-panel" role="dialog" aria-modal="true" aria-label="เส้นทางและตำแหน่ง">
        <header className="chat-route-header">
          <div>
            <h3>เส้นทางและตำแหน่ง</h3>
            <p>ข้อมูลตำแหน่งจากแชทนี้และคำสั่งซื้อที่เชื่อมอยู่</p>
          </div>
          <button type="button" className="chat-route-close" onClick={onClose} aria-label="ปิดแผนที่" autoFocus>
            <CloseIcon />
          </button>
        </header>

        <div className="chat-route-body">
          {loading && <div className="chat-route-state">กำลังโหลดข้อมูลตำแหน่ง...</div>}
          {!loading && routeError && (
            <div className="chat-route-state chat-route-error">{routeError}</div>
          )}

          {!loading && mapPoints.length > 0 && (
            <div className="chat-route-map">
              <MapContainer
                center={[mapPoints[0].lat, mapPoints[0].lng]}
                zoom={14}
                style={{ width: "100%", height: "100%" }}
                scrollWheelZoom
              >
                <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
                <FitBounds points={mapPoints} />
                {origin && selectedGpsTarget && (
                  <Polyline
                    positions={[
                      [origin.lat, origin.lng],
                      [selectedGpsTarget.lat, selectedGpsTarget.lng],
                    ]}
                    pathOptions={{ color: "#2563eb", weight: 3, dashArray: "6 8" }}
                  />
                )}
                {origin && (
                  <Marker position={[origin.lat, origin.lng]} icon={storeIcon}>
                    <Popup>
                      <strong>ตำแหน่งร้าน</strong>
                      <br />
                      {origin.label}
                      {origin.address ? <><br />{origin.address}</> : null}
                    </Popup>
                  </Marker>
                )}
                {selectedTarget && (
                  <Marker
                    position={[selectedTarget.lat, selectedTarget.lng]}
                    icon={selectedIsIp ? ipIcon : customerIcon}
                  >
                    <Popup>
                      <strong>{sourceLabel(selectedTarget)}</strong>
                      <br />
                      {selectedTarget.label}
                      {selectedTarget.address ? <><br />{selectedTarget.address}</> : null}
                    </Popup>
                  </Marker>
                )}
              </MapContainer>
            </div>
          )}

          {!loading && mapPoints.length === 0 && (
            <div className="chat-route-state">
              ยังไม่มีข้อมูลตำแหน่งจริงสำหรับแสดงบนแผนที่
            </div>
          )}

          <section className="chat-route-section">
            <h4>ต้นทาง</h4>
            {origin ? (
              <div className="chat-route-origin">
                <span className="chat-route-role chat-route-role-store">
                  <PinIcon /> ร้าน
                </span>
                <strong>{origin.label}</strong>
                {origin.address && <span className="chat-route-addr">{origin.address}</span>}
                <span className="chat-route-coords">{origin.lat.toFixed(6)}, {origin.lng.toFixed(6)}</span>
              </div>
            ) : (
              <div className="chat-route-empty">ร้านยังไม่ได้ระบุพิกัดในโปรไฟล์ร้าน</div>
            )}
          </section>

          <section className="chat-route-section">
            <h4>จุดหมายปลายทาง</h4>

            <div className="chat-route-card">
              <div className="chat-route-card-head">
                <span className="chat-route-card-title">
                  <PinIcon /> ตำแหน่งที่ลูกค้าส่งเอง
                </span>
                <span className="chat-route-badge chat-route-badge-gps">GPS / Location</span>
              </div>
              {gpsTargets.length === 0 ? (
                <div className="chat-route-empty">ยังไม่มีข้อมูลตำแหน่งจากลูกค้า (Location/GPS)</div>
              ) : (
                <div className="chat-route-targets" role="radiogroup" aria-label="เลือกตำแหน่งที่ลูกค้าส่งเอง">
                  {gpsTargets.map((target) => {
                    const active = target.key === selectedKey;
                    return (
                      <button
                        key={target.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`chat-route-target${active ? " active" : ""}`}
                        onClick={() => selectTarget(target.key)}
                      >
                        <span className="chat-route-role">
                          <PinIcon /> {sourceLabel(target)}
                        </span>
                        <strong>{target.label}</strong>
                        {target.address && <span className="chat-route-addr">{target.address}</span>}
                        {target.orderNumber && (
                          <span className="chat-route-order">ออเดอร์ #{target.orderNumber}</span>
                        )}
                        {target.createdAt && (
                          <span className="chat-route-when">แชร์เมื่อ {formatTime(target.createdAt)}</span>
                        )}
                        <span className="chat-route-coords">
                          {target.lat.toFixed(6)}, {target.lng.toFixed(6)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="chat-route-card chat-route-card-ip">
              <div className="chat-route-card-head">
                <span className="chat-route-card-title">
                  <PinIcon /> ตำแหน่งโดยประมาณจาก IP
                </span>
                <span className="chat-route-badge chat-route-badge-ip">ไม่ใช่ GPS</span>
              </div>

              {ipLoading && (
                <div className="chat-route-state chat-route-state-inline">กำลังโหลดตำแหน่งโดยประมาณจาก IP...</div>
              )}
              {!ipLoading && ipError && (
                <div className="chat-route-state chat-route-state-inline chat-route-error">{ipError}</div>
              )}
              {!ipLoading && !ipError && !ipTarget && (
                <div className="chat-route-empty">
                  {IP_REASON_TEXT[ipLocation?.reason] || "ยังไม่มีข้อมูลตำแหน่งโดยประมาณจาก IP"}
                </div>
              )}
              {!ipLoading && !ipError && ipTarget && (
                <>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selectedKey === ipTarget.key}
                    className={`chat-route-target chat-route-target-ip${selectedKey === ipTarget.key ? " active" : ""}`}
                    onClick={() => selectTarget(ipTarget.key)}
                  >
                    <span className="chat-route-role chat-route-role-ip">
                      <PinIcon /> ตำแหน่งโดยประมาณจาก IP
                    </span>
                    <strong>{ipTarget.label}</strong>
                    <span className="chat-route-coords">
                      {ipTarget.lat.toFixed(6)}, {ipTarget.lng.toFixed(6)}
                    </span>
                    {ipTarget.accuracyRadiusKm !== null && (
                      <span className="chat-route-accuracy">รัศมีคลาดเคลื่อน ±{ipTarget.accuracyRadiusKm} กม.</span>
                    )}
                    {ipTarget.observedAt && (
                      <span className="chat-route-when">ตรวจพบเมื่อ {formatTime(ipTarget.observedAt)}</span>
                    )}
                    {(ipTarget.isVpn || ipTarget.isProxy || ipTarget.isHosting) && (
                      <span className="chat-route-ip-warning">
                        ตรวจพบสัญญาณ VPN/Proxy — ตำแหน่งอาจคลาดเคลื่อนสูง
                      </span>
                    )}
                  </button>
                  <div className="chat-route-ip-note">
                    เป็นตำแหน่งประมาณจาก IP ไม่ใช่ GPS และไม่ถูกใช้เป็นจุดส่งสินค้าหรือคำนวณเส้นทาง
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="chat-route-section">
            <h4>สรุปเส้นทาง</h4>
            {selectedIsIp ? (
              <div className="chat-route-note chat-route-ip-route-note">
                ตำแหน่งจาก IP ใช้เพื่อการประมาณเท่านั้น ไม่ใช้เป็นจุดส่งสินค้า
                และไม่ใช้คำนวณเส้นทางหรือระยะทาง
              </div>
            ) : origin && selectedGpsTarget ? (
              <>
                <div className="chat-route-summary">
                  <span>ระยะทางเส้นตรง (ประมาณ)</span>
                  <strong>{formatDistance(distanceMeters) || "-"}</strong>
                </div>
                <div className="chat-route-note">
                  ระบบยังไม่มี Routing API จึงไม่สามารถคำนวณเส้นทางถนนและเวลาเดินทางได้
                  เส้นประบนแผนที่เป็นเพียงแนวเส้นตรงอ้างอิงระหว่างสองจุด ไม่ใช่เส้นทางถนน
                </div>
              </>
            ) : (
              <div className="chat-route-empty">
                ต้องมีทั้งตำแหน่งร้านและตำแหน่ง GPS/Location ที่ลูกค้าส่งจึงจะคำนวณระยะทางได้
              </div>
            )}
          </section>

          {googleMapsUrl && (
            <a
              className="chat-route-nav-link"
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <PinIcon /> เปิดนำทางด้วย Google Maps
            </a>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}
