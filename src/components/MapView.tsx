import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, InfoWindow, Marker, useJsApiLoader } from "@react-google-maps/api";
import type { ParsedPlace } from "../types";
import { MAPS_LIBRARIES, MAPS_SCRIPT_ID } from "../lib/geocode";

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "place" | "basecamp" | "recommended";
  googlePlaceId?: string;
}

// 저장된 place_id(있으면)나 좌표로 구글 지도 상세 페이지 링크를 만든다. API 호출 없이 그냥 URL 조립.
function googleMapsLink(pin: MapPin): string {
  return pin.googlePlaceId
    ? `https://www.google.com/maps/place/?q=place_id:${pin.googlePlaceId}`
    : `https://www.google.com/maps?q=${pin.lat},${pin.lng}`;
}

interface MapViewProps {
  pins: MapPin[];
  height?: number;
  focusId?: string | null;
}

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

function SchematicMap({ pins, height = 420, focusId }: MapViewProps) {
  const bounds = useMemo(() => {
    if (pins.length === 0) return { minLat: 37.5, maxLat: 37.6, minLng: 126.9, maxLng: 127.0 };
    const lats = pins.map((p) => p.lat);
    const lngs = pins.map((p) => p.lng);
    const pad = 0.01;
    return {
      minLat: Math.min(...lats) - pad,
      maxLat: Math.max(...lats) + pad,
      minLng: Math.min(...lngs) - pad,
      maxLng: Math.max(...lngs) + pad,
    };
  }, [pins]);

  const project = (lat: number, lng: number) => {
    const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng || 1)) * 100;
    const y = 100 - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat || 1)) * 100;
    return { x, y };
  };

  const colorFor = (kind: MapPin["kind"]) =>
    kind === "basecamp" ? "#e8590c" : kind === "recommended" ? "#2f9e44" : "#1c7ed6";

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        background: "linear-gradient(135deg,#eef2f6,#e2e8f0)",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #d0d7de",
      }}
    >
      <div style={{ position: "absolute", top: 8, left: 8, fontSize: 11, color: "#666", background: "#fff9", padding: "2px 8px", borderRadius: 6 }}>
        지도 API 키 미설정 · 스키매틱 미리보기
      </div>
      {pins.map((pin) => {
        const { x, y } = project(pin.lat, pin.lng);
        const focused = pin.id === focusId;
        const size = focused ? (pin.kind === "place" ? 16 : 22) : pin.kind === "place" ? 10 : 16;
        return (
          <a
            key={pin.id}
            href={googleMapsLink(pin)}
            target="_blank"
            rel="noreferrer"
            title={`${pin.label} · 구글 지도에서 보기`}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              transform: "translate(-50%,-100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              zIndex: focused ? 2 : 1,
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: size,
                height: size,
                borderRadius: "50%",
                background: colorFor(pin.kind),
                border: focused ? "3px solid #ffd43b" : "2px solid white",
                boxShadow: focused ? "0 0 0 4px rgba(255,212,59,0.35)" : "0 1px 3px rgba(0,0,0,.3)",
              }}
            />
            {(pin.kind !== "place" || focused) && (
              <span style={{ fontSize: 10, background: "#fff", padding: "0 4px", borderRadius: 4, marginTop: 2, whiteSpace: "nowrap" }}>
                {pin.label}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}

function RealMap({ pins, height = 420, focusId }: MapViewProps) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: MAPS_KEY as string,
    id: MAPS_SCRIPT_ID,
    libraries: MAPS_LIBRARIES,
  });
  const mapRef = useRef<google.maps.Map | null>(null);
  const [infoPinId, setInfoPinId] = useState<string | null>(null);
  const infoPin = pins.find((p) => p.id === infoPinId) ?? null;

  const center = useMemo(() => {
    if (pins.length === 0) return { lat: 37.5665, lng: 126.978 };
    const basecamp = pins.find((p) => p.kind === "basecamp" || p.kind === "recommended");
    if (basecamp) return { lat: basecamp.lat, lng: basecamp.lng };
    return { lat: pins[0].lat, lng: pins[0].lng };
  }, [pins]);

  useEffect(() => {
    if (!focusId || !mapRef.current) return;
    const pin = pins.find((p) => p.id === focusId);
    if (!pin) return;
    mapRef.current.panTo({ lat: pin.lat, lng: pin.lng });
    mapRef.current.setZoom(16);
  }, [focusId, pins]);

  if (!isLoaded) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>지도 불러오는 중...</div>;

  return (
    <GoogleMap
      mapContainerStyle={{ width: "100%", height, borderRadius: 12 }}
      center={center}
      zoom={13}
      onLoad={(map) => {
        mapRef.current = map;
      }}
    >
      {pins.map((pin) => {
        const focused = pin.id === focusId;
        return (
          <Marker
            key={pin.id}
            position={{ lat: pin.lat, lng: pin.lng }}
            label={pin.kind !== "place" ? { text: pin.label, fontSize: "11px" } : undefined}
            zIndex={focused ? 999 : undefined}
            onClick={() => setInfoPinId(pin.id)}
            icon={
              pin.kind === "place"
                ? focused
                  ? {
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 9,
                      fillColor: "#1c7ed6",
                      fillOpacity: 1,
                      strokeColor: "#ffd43b",
                      strokeWeight: 3,
                    }
                  : undefined
                : {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: pin.kind === "basecamp" ? "#e8590c" : "#2f9e44",
                    fillOpacity: 1,
                    strokeColor: "#fff",
                    strokeWeight: 2,
                  }
            }
          />
        );
      })}
      {infoPin && (
        <InfoWindow position={{ lat: infoPin.lat, lng: infoPin.lng }} onCloseClick={() => setInfoPinId(null)}>
          <div style={{ fontSize: 13, maxWidth: 180 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{infoPin.label}</div>
            <a href={googleMapsLink(infoPin)} target="_blank" rel="noreferrer" style={{ color: "#1c7ed6" }}>
              구글 지도에서 보기 ↗
            </a>
          </div>
        </InfoWindow>
      )}
    </GoogleMap>
  );
}

export function MapView(props: MapViewProps) {
  return MAPS_KEY ? <RealMap {...props} /> : <SchematicMap {...props} />;
}

export function placesToPins(places: ParsedPlace[]): MapPin[] {
  return places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name, kind: "place" as const }));
}
