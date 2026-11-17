import { useEffect, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";

const DEFAULT_CENTER = { lat: 13.7563, lng: 100.5018 };
const DEFAULT_ZOOM = 12;
const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const pinIcon = L.divIcon({
  className: "store-pin-marker",
  html: '<span class="store-pin-dot"></span>',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
});

const round7 = (value) => Math.round(value * 1e7) / 1e7;

const isValidLat = (value) => Number.isFinite(value) && value >= -90 && value <= 90;
const isValidLng = (value) => Number.isFinite(value) && value >= -180 && value <= 180;

function MapInvalidator() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function MapRecenter({ signal, position }) {
  const map = useMap();
  useEffect(() => {
    if (signal > 0 && position) {
      map.setView([position.lat, position.lng], Math.max(map.getZoom(), 15));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);
  return null;
}

function CoordinatesInputs({ value, onPick, disabled }) {
  const [latInput, setLatInput] = useState(value?.lat ?? "");
  const [lngInput, setLngInput] = useState(value?.lng ?? "");
  const [inputError, setInputError] = useState("");

  useEffect(() => {
    setLatInput(value?.lat ?? "");
    setLngInput(value?.lng ?? "");
    setInputError("");
  }, [value?.lat, value?.lng]);

  const commitInputs = () => {
    if (latInput === "" && lngInput === "") {
      onPick(null);
      return;
    }
    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (latInput === "" || lngInput === "" || !isValidLat(lat) || !isValidLng(lng)) {
      setInputError("กรุณากรอกละติจูด (-90 ถึง 90) และลองจิจูด (-180 ถึง 180)");
      return;
    }
    setInputError("");
    onPick({ lat: round7(lat), lng: round7(lng) });
  };

  return (
    <div className="store-location-inputs">
      <div className="form-group">
        <label className="form-label" htmlFor="store-latitude">ละติจูด (Latitude)</label>
        <input
          id="store-latitude"
          type="number"
          className="form-input"
          inputMode="decimal"
          step="any"
          min="-90"
          max="90"
          placeholder="เช่น 13.7563"
          value={latInput}
          onChange={(event) => setLatInput(event.target.value)}
          onBlur={commitInputs}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitInputs();
            }
          }}
          disabled={disabled}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="store-longitude">ลองจิจูด (Longitude)</label>
        <input
          id="store-longitude"
          type="number"
          className="form-input"
          inputMode="decimal"
          step="any"
          min="-180"
          max="180"
          placeholder="เช่น 100.5018"
          value={lngInput}
          onChange={(event) => setLngInput(event.target.value)}
          onBlur={commitInputs}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitInputs();
            }
          }}
          disabled={disabled}
        />
      </div>
      {inputError && <p className="form-hint store-location-error">{inputError}</p>}
    </div>
  );
}

export default function StoreLocationMap({
  value = null,
  onChange,
  readOnly = false,
  height = 280,
  storeName = "",
  markerLabel = "ตำแหน่งร้านค้า",
  hint = "คลิกบนแผนที่เพื่อปักหมุด หรือลากหมุดไปยังตำแหน่งร้านค้าจริง",
}) {
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [recenterSignal, setRecenterSignal] = useState(0);

  const center = value && isValidLat(value.lat) && isValidLng(value.lng)
    ? [value.lat, value.lng]
    : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng];

  const handlePick = (coords) => {
    if (readOnly || !onChange) return;
    setGeoError("");
    onChange(coords ? { lat: round7(coords.lat), lng: round7(coords.lng) } : null);
  };

  const handleLocate = () => {
    if (!navigator.geolocation) {
      setGeoError("เบราว์เซอร์ไม่รองรับการระบุตำแหน่ง");
      return;
    }
    setLocating(true);
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        handlePick({ lat: position.coords.latitude, lng: position.coords.longitude });
        setRecenterSignal((signal) => signal + 1);
        setLocating(false);
      },
      (error) => {
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? "ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่งของคุณ"
            : "ไม่สามารถระบุตำแหน่งของคุณได้"
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="store-location-field">
      <div className="store-location-map" style={{ height }}>
        <MapContainer
          center={center}
          zoom={value ? 15 : DEFAULT_ZOOM}
          scrollWheelZoom={!readOnly}
          className="store-location-canvas"
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
          <MapInvalidator />
          {!readOnly && <MapClickHandler onPick={handlePick} />}
          {value && isValidLat(value.lat) && isValidLng(value.lng) && (
            <Marker
              position={[value.lat, value.lng]}
              icon={pinIcon}
              draggable={!readOnly}
              eventHandlers={{
                dragend: (event) => {
                  const { lat, lng } = event.target.getLatLng();
                  handlePick({ lat, lng });
                },
              }}
            >
              <Popup>
                {storeName ? <strong>{storeName}</strong> : <strong>{markerLabel}</strong>}
                {!readOnly && <br />}
                {!readOnly && "ลากหมุดเพื่อปรับตำแหน่ง"}
              </Popup>
            </Marker>
          )}
          {!readOnly && <MapRecenter signal={recenterSignal} position={value} />}
        </MapContainer>
      </div>

      {!readOnly && (
        <>
          <div className="store-location-toolbar">
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleLocate}
              disabled={locating}
            >
              {locating ? "กำลังระบุตำแหน่ง..." : "ใช้ตำแหน่งของฉัน"}
            </button>
            {value && (
              <button type="button" className="btn btn-outline" onClick={() => handlePick(null)}>
                ล้างหมุด
              </button>
            )}
          </div>
          <p className="form-hint">{hint}</p>
          {geoError && <p className="form-hint store-location-error">{geoError}</p>}
          <CoordinatesInputs value={value} onPick={handlePick} disabled={locating} />
        </>
      )}

      {readOnly && value && isValidLat(value.lat) && isValidLng(value.lng) && (
        <div className="store-location-footer">
          <span>
            พิกัด: {value.lat}, {value.lng}
          </span>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${value.lat},${value.lng}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-outline"
          >
            เปิดใน Google Maps
          </a>
        </div>
      )}
    </div>
  );
}