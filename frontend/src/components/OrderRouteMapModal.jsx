import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";
import { orderAPI, chatAPI } from "../api";
import "./ChatRoom.css";

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const storeIcon = L.divIcon({
  className: "order-route-pin",
  html: '<span class="order-route-pin-dot store"></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -14],
});

const customerIcon = L.divIcon({
  className: "order-route-pin",
  html: '<span class="order-route-pin-dot customer"></span>',
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

const formatDistance = (meters) => {
  if (!Number.isFinite(meters) || meters < 0) return null;
  if (meters < 1000) return `${Math.round(meters)} ม.`;
  return `${Math.round(meters / 100) / 10} กม.`;
};

const formatDuration = (minutes) => {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 60) return `${Math.round(minutes)} นาที`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`;
};

// Geometry จาก OSRM ส่งคืนเป็น [[lat, lng], ...] (แปลงจาก [lng, lat] ของ OSRM แล้วใน Backend)
// แปลงเป็นรูปแบบ Leaflet [lat, lng] และกรองจุดที่ไม่ถูกต้องออก ไม่สร้างจุดขึ้นมาใหม่
const geometryToPositions = (geometry) => {
  // Support both Backend's native [[lat,lng],...] and GeoJSON LineString if ever sent.
  let coords = geometry;
  let isGeoJson = false;
  if (geometry && typeof geometry === "object" && !Array.isArray(geometry) && geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    coords = geometry.coordinates;
    isGeoJson = true;
  }
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return coords
    .map((p) => {
      if (!Array.isArray(p) || p.length < 2) return null;
      const [a, b] = [Number(p[0]), Number(p[1])];
      // GeoJSON coordinates are [lng,lat]; Backend native is [lat,lng].
      const [lat, lng] = isGeoJson ? [b, a] : [a, b];
      return [lat, lng];
    })
    .filter(
      (p) =>
        p &&
        p.length === 2 &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]) &&
        p[0] >= -90 &&
        p[0] <= 90 &&
        p[1] >= -180 &&
        p[1] <= 180
    );
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
      { padding: [44, 44] }
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

const REASON_MESSAGES = {
  no_store: "ไม่พบร้านค้าในบทสนทนานี้",
  missing_store_location: "ร้านค้ายังไม่ได้ระบุพิกัดที่อยู่ในระบบ",
  missing_destination_location: "ยังไม่มีพิกัดจุดจัดส่งของลูกค้าสำหรับออเดอร์นี้",
};

const sourceLabel = (source) => {
  switch (source) {
    case "order_gps":
      return "GPS จากคำสั่งซื้อ";
    case "order_address":
      return "ที่อยู่จากคำสั่งซื้อ";
    case "chat_location":
      return "ตำแหน่งที่ลูกค้าแชร์ในแชท";
    case "store_address":
      return "พิกัดร้านค้า";
    default:
      return source;
  }
};

// สร้างคำแนะนำเลี้ยวซ้าย/ขวาจากขั้นตอนของ OSRM
function buildInstructions(routes) {
  const route = Array.isArray(routes) && routes.length > 0 ? routes[0] : null;
  const steps =
    route && route.legs && route.legs.length > 0
      ? route.legs[0].steps
      : null;
  if (!steps || steps.length === 0) return null;

  const instructions = [];
  for (const step of steps) {
    const maneuver = step.maneuver || {};
    const type = maneuver.type;
    const modifier = maneuver.modifier;
    const name = step.name || "";
    const distance = formatDistance(step.distance);

    let text = "";
    if (type === "depart") {
      text = "เริ่มต้นจากจุดรับ";
    } else if (type === "arrive") {
      text = "ถึงจุดหมายปลายทาง";
    } else if (modifier === "left") {
      text = name ? `เลี้ยวซ้ายเข้าถนน${name}` : "เลี้ยวซ้าย";
    } else if (modifier === "right") {
      text = name ? `เลี้ยวขวาเข้าถนน${name}` : "เลี้ยวขวา";
    } else if (modifier === "straight") {
      text = name ? `ตรงไปบนถนน${name}` : "ตรงไป";
    } else if (name) {
      text = `ไปบนถนน${name}`;
    }
    if (!text) continue;
    if (distance) text += ` (${distance})`;
    instructions.push(text);
  }
  return instructions.length > 0 ? instructions : null;
}

export default function OrderRouteMapModal({
  open,
  onClose,
  conversationId,
  mode,
  orderId,
  storeName,
  orderNumber,
}) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setRoute(null);
      setLoading(false);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setRoute(null);

    const fetchRoute = async () => {
      if (orderId) {
        try {
          const res = await orderAPI.getRoute(orderId, mode);
          const data = res?.data || res || null;
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[OrderRouteMapModal] route response (order)", {
              routing_source: data?.routing_source,
              geometry_type: Array.isArray(data?.geometry) ? "array" : data?.geometry?.type || typeof data?.geometry,
              geometry_count: Array.isArray(data?.geometry) ? data.geometry.length : Array.isArray(data?.geometry?.coordinates) ? data.geometry.coordinates.length : null,
              positions_count: Array.isArray(data?.geometry) ? geometryToPositions(data.geometry)?.length ?? 0 : null,
              distance_meters: data?.distance_meters,
              duration_minutes: data?.duration_minutes,
              routing_error: data?.routing_error,
            });
          }
          if (!cancelled) setRoute(data);
          if (!cancelled) setLoading(false);
          return;
        } catch (orderErr) {
          // Fall through to conversationId-based lookup below.
        }
      }

      if (conversationId) {
         try {
           const res = await chatAPI.getRoute(conversationId, mode);
           const data = res?.data || res || null;
           if (import.meta.env.DEV) {
             // eslint-disable-next-line no-console
             console.debug("[OrderRouteMapModal] route response (conversation)", {
               routing_source: data?.routing_source,
               geometry_type: Array.isArray(data?.geometry) ? "array" : data?.geometry?.type || typeof data?.geometry,
               geometry_count: Array.isArray(data?.geometry) ? data.geometry.length : Array.isArray(data?.geometry?.coordinates) ? data.geometry.coordinates.length : null,
               positions_count: Array.isArray(data?.geometry) ? geometryToPositions(data.geometry)?.length ?? 0 : null,
               distance_meters: data?.distance_meters,
               duration_minutes: data?.duration_minutes,
               routing_error: data?.routing_error,
             });
           }
           if (!cancelled) setRoute(data);
         } catch (convErr) {
          if (!cancelled) setError(convErr.message || "ไม่สามารถโหลดข้อมูลเส้นทางได้");
        }
      }

      if (!cancelled) setLoading(false);
    };

    fetchRoute();

    return () => {
      cancelled = true;
    };
  }, [open, conversationId, mode, orderId]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const origin = route?.origin;
  const destination = route?.destination;
  const hasOrigin = Boolean(origin && isValidLatLng(origin.lat, origin.lng));
  const hasDestination = Boolean(destination && isValidLatLng(destination.lat, destination.lng));
  const displayOrderNumber = orderNumber || route?.order_number || "-";
  const isStraightLine = route?.routing_source === "straight_line";
  // OSRM สำเร็จแต่ Geometry หาย/ผิดรูปแบบ → ถือว่าใช้งานไม่ได้ ไม่สร้างเส้นตรงอ้างว่าเป็น OSRM
  const osrmButNoGeometry = route?.routing_source === "osrm" && !geometryToPositions(route?.geometry);
  const instructions = buildInstructions(route?.routes);

  if (!open) return null;

  return createPortal(
    <div className="order-route-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="order-route-panel" role="dialog" aria-modal="true" aria-label="แผนที่เส้นทางจัดส่ง">
        <header className="order-route-header">
          <div>
            <h3>แผนที่เส้นทางจัดส่ง</h3>
            <p>
              ออเดอร์ #{displayOrderNumber}
              {storeName ? ` • ${storeName}` : ""}
              {orderId ? ` (${orderId})` : ""}
            </p>
          </div>
          <button type="button" className="order-route-close" onClick={onClose} aria-label="ปิดแผนที่" autoFocus>
            <CloseIcon />
          </button>
        </header>

        <div className="order-route-body">
          {loading && <div className="order-route-state">กำลังโหลดข้อมูลแผนที่...</div>}

          {!loading && error && (
            <div className="order-route-state order-route-error" role="alert">
              {error}
            </div>
          )}

          {!loading && !error && !route?.available && (
            <div className="order-route-state order-route-error" role="alert">
              {REASON_MESSAGES[route?.reason] || "ข้อมูลตำแหน่งยังไม่ครบ ไม่สามารถแสดงเส้นทางได้"}
            </div>
          )}

          {!loading && !error && route?.available && hasOrigin && hasDestination && (
            <>
              {isStraightLine && route?.routing_error && (
                <div className="order-route-state order-route-warning" role="alert">
                  ⚠️ {route.routing_error} แสดงเส้นตรงเป็นข้อมูลอ้างอิงเท่านั้น ไม่ใช่เส้นทางถนนจริง
                </div>
              )}
              {osrmButNoGeometry && (
                <div className="order-route-state order-route-warning" role="alert">
                  ⚠️ ไม่พบข้อมูลเส้นทางจาก OSRM แสดงเส้นตรงเป็นข้อมูลอ้างอิงเท่านั้น ไม่ใช่เส้นทางถนนจริง
                </div>
              )}

              <div className="order-route-map">
                <MapContainer
                  center={[origin.lat, origin.lng]}
                  zoom={14}
                  scrollWheelZoom
                  attributionControl={false}
                  style={{ width: "100%", height: "100%" }}
                >
                  <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
                  <FitBounds points={[origin, destination].filter(Boolean)} />
                  {(geometryToPositions(route?.geometry) || isStraightLine || osrmButNoGeometry) && hasOrigin && hasDestination && (
                    <Polyline
                      positions={
                        geometryToPositions(route?.geometry) ||
                        [[origin.lat, origin.lng], [destination.lat, destination.lng]]
                      }
                      pathOptions={{
                        color: isStraightLine || osrmButNoGeometry ? "#ef4444" : "#2563eb",
                        weight: 4,
                        opacity: 0.9,
                        dashArray: isStraightLine || osrmButNoGeometry ? "7 8" : undefined,
                        lineJoin: "round",
                        lineCap: "round",
                      }}
                    />
                  )}
                  {hasOrigin && (
                    <Marker position={[origin.lat, origin.lng]} icon={storeIcon}>
                      <Popup>
                        <strong>ต้นทาง – ร้านค้า</strong>
                        <br />
                        {origin.label}
                        {origin.address ? <><br />{origin.address}</> : null}
                      </Popup>
                    </Marker>
                  )}
                  {hasDestination && (
                    <Marker position={[destination.lat, destination.lng]} icon={customerIcon}>
                      <Popup>
                        <strong>ปลายทาง – จัดส่งถึงลูกค้า</strong>
                        <br />
                        {destination.label}
                        {destination.address ? <><br />{destination.address}</> : null}
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>
              </div>

              <section className="order-route-summary">
                <div className="order-route-card">
                  <div className="order-route-card-head">
                    <span className="order-route-role order-route-role-store">ต้นทาง</span>
                  </div>
                  <strong>{origin?.label || storeName || "ร้านค้า"}</strong>
                  {origin?.address && <span className="order-route-addr">{origin.address}</span>}
                  {hasOrigin && <span className="order-route-coords">{origin.lat.toFixed(6)}, {origin.lng.toFixed(6)}</span>}
                  {origin?.source && <span className="order-route-source">{sourceLabel(origin.source)}</span>}
                </div>
                <div className="order-route-card">
                  <div className="order-route-card-head">
                    <span className="order-route-role order-route-role-customer">ปลายทาง</span>
                  </div>
                  <strong>{destination?.label || "จุดจัดส่งลูกค้า"}</strong>
                  {destination?.address && <span className="order-route-addr">{destination.address}</span>}
                  {hasDestination && <span className="order-route-coords">{destination.lat.toFixed(6)}, {destination.lng.toFixed(6)}</span>}
                  {destination?.source && (
                    <span className="order-route-source">{sourceLabel(destination.source)}</span>
                  )}
                  {destination?.verified && <span className="order-route-source order-route-source-verified">ตรวจสอบแล้ว</span>}
                </div>
              </section>

              <div className="order-route-mode">
                <span className="order-route-mode-label">ประเภทการเดินทาง</span>
                <strong className="order-route-mode-value">ขับรถ (Driving)</strong>
              </div>

              {route.distance_meters !== null && route.distance_meters !== undefined && (
                <div className="order-route-stat">
                  <span>
                    {isStraightLine ? "ระยะทางเส้นตรง (อ้างอิง)" : "ระยะทางตามถนนจริง"}
                  </span>
                  <strong>{formatDistance(route.distance_meters)}</strong>
                </div>
              )}
              {route.duration_minutes !== null && route.duration_minutes !== undefined && (
                <div className="order-route-stat">
                  <span>เวลาเดินทางโดยประมาณ</span>
                  <strong>{formatDuration(route.duration_minutes)}</strong>
                  {route.duration_source === "osrm" && (
                    <span className="order-route-source" style={{ marginLeft: 8, fontWeight: 600 }}>จาก OSRM</span>
                  )}
                </div>
              )}

              {instructions && instructions.length > 0 && (
                <section className="order-route-instructions">
                  <h4 className="order-route-instructions-head">คำแนะนำการเดินทาง</h4>
                  <ul className="order-route-instructions-list">
                    {instructions.map((text, index) => (
                      <li key={index} className="order-route-instruction-item">
                        {index + 1}. {text}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="order-route-note">
                {isStraightLine || osrmButNoGeometry
                  ? "ผู้ให้บริการคำนวณเส้นทางถนนใช้งานไม่ได้ในขณะนี้ ระบบจึงแสดงเส้นตรงเชื่อมต้นทางกับปลายทางเป็นข้อมูลอ้างอิงเท่านั้น ไม่ใช่เส้นทางถนนจริง และไม่สามารถบอกเวลาเดินทางที่แน่นอนได้"
                  : "ข้อมูลระยะทางและเวลาเดินทางคำนวณจากเส้นทางถนนจริงโดยผู้ให้บริการนำทาง (OSRM, ข้อมูลถนนจาก OpenStreetMap)"}
              </p>
            </>
          )}

          {!loading && !error && route?.available && !(hasOrigin && hasDestination) && (
            <div className="order-route-state order-route-error" role="alert">
              ข้อมูลตำแหน่งยังไม่ครบ ไม่สามารถแสดงเส้นทางได้
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}
