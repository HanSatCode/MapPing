import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Autocomplete, useJsApiLoader } from "@react-google-maps/api";
import { ProgressBar } from "../components/ProgressBar";
import { useWizard } from "../lib/WizardContext";
import { geocodePlace, hasMapsKey, MAPS_LIBRARIES, MAPS_SCRIPT_ID } from "../lib/geocode";
import { WIZARD_STEPS } from "../lib/wizardSteps";
import { getDestination } from "../lib/destinations";
import { Toggle } from "../components/Toggle";

export default function DaysBasecampSetup() {
  const navigate = useNavigate();
  const { destination, days, setDays, basecamp, setBasecamp, basecampUndecided, setBasecampUndecided, allowCar, setAllowCar } = useWizard();
  const destinationCenter = getDestination(destination);
  const [basecampName, setBasecampName] = useState(basecamp?.name ?? "");
  const [pickedPlace, setPickedPlace] = useState<{ address?: string; lat: number; lng: number } | null>(
    basecamp ? { address: basecamp.address, lat: basecamp.lat, lng: basecamp.lng } : null
  );
  const [loading, setLoading] = useState(false);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? "",
    id: MAPS_SCRIPT_ID,
    libraries: MAPS_LIBRARIES,
  });

  const handlePlaceChanged = () => {
    const place = autocompleteRef.current?.getPlace();
    if (!place?.geometry?.location) return;
    const name = place.name || place.formatted_address || basecampName;
    setBasecampName(name);
    setPickedPlace({ address: place.formatted_address, lat: place.geometry.location.lat(), lng: place.geometry.location.lng() });
  };

  const handleStart = async () => {
    if (days < 1) {
      alert("여행 일수를 1일 이상으로 입력해주세요.");
      return;
    }
    if (!basecampUndecided && !basecampName.trim()) {
      alert("숙소를 입력하거나 '숙소 미정'을 선택해주세요.");
      return;
    }

    setLoading(true);
    if (!basecampUndecided) {
      if (pickedPlace && pickedPlace.address !== undefined) {
        setBasecamp({ name: basecampName, address: pickedPlace.address, lat: pickedPlace.lat, lng: pickedPlace.lng });
      } else {
        const geo = await geocodePlace(basecampName, destinationCenter);
        setBasecamp({ name: basecampName, address: geo.address, lat: geo.lat, lng: geo.lng });
      }
    } else {
      setBasecamp(null);
    }
    setLoading(false);
    navigate("/new/parsing");
  };

  return (
    <div className="page-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px", width: "100%" }}>
      <ProgressBar steps={WIZARD_STEPS} currentIndex={2} />
      <h2 style={{ marginBottom: 28, fontSize: 22 }}>🗓️ 여행 일정과 숙소를 알려주세요</h2>

      <div className="card" style={{ padding: 24, marginBottom: 18 }}>
        <label style={{ display: "block", fontWeight: 700, marginBottom: 10, fontSize: 14 }}>며칠 동안 여행하시나요?</label>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 1)}
            style={{ width: 100, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 15 }}
          />
          <span style={{ color: "var(--text-muted)", fontSize: 14 }}>일</span>
        </div>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 28 }}>
        <label style={{ display: "block", fontWeight: 700, marginBottom: 10, fontSize: 14 }}>머무르실 숙소가 있다면 알려주세요</label>
        {hasMapsKey && isLoaded ? (
          <Autocomplete
            onLoad={(ac) => (autocompleteRef.current = ac)}
            onPlaceChanged={handlePlaceChanged}
            options={{
              fields: ["name", "formatted_address", "geometry"],
              bounds: {
                north: destinationCenter.lat + 0.35,
                south: destinationCenter.lat - 0.35,
                east: destinationCenter.lng + 0.35,
                west: destinationCenter.lng - 0.35,
              },
            }}
          >
            <input
              type="text"
              value={basecampName}
              onChange={(e) => {
                setBasecampName(e.target.value);
                setPickedPlace(null);
              }}
              disabled={basecampUndecided}
              placeholder="숙소 이름 또는 주소 검색"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                fontSize: 15,
                marginBottom: 14,
                boxSizing: "border-box",
                background: basecampUndecided ? "#f1f2f6" : "#fff",
              }}
            />
          </Autocomplete>
        ) : (
          <input
            type="text"
            value={basecampName}
            onChange={(e) => {
              setBasecampName(e.target.value);
              setPickedPlace(null);
            }}
            disabled={basecampUndecided}
            placeholder={hasMapsKey ? "숙소 이름 또는 주소 검색" : "숙소 이름 입력 (지도 API 키 없어 자동완성 비활성)"}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              fontSize: 15,
              marginBottom: 14,
              boxSizing: "border-box",
              background: basecampUndecided ? "#f1f2f6" : "#fff",
            }}
          />
        )}

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            padding: "12px 14px",
            borderRadius: 10,
            background: basecampUndecided ? "var(--primary-light)" : "transparent",
            border: basecampUndecided ? "1px solid #c7d6fb" : "1px solid transparent",
            transition: "all 0.15s ease",
          }}
        >
          <input type="checkbox" checked={basecampUndecided} onChange={(e) => setBasecampUndecided(e.target.checked)} />
          <span style={{ fontSize: 14 }}>✨ 아직 숙소를 못 정했어요 (최적 위치를 추천해드려요!)</span>
        </label>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 28 }}>
        <Toggle
          checked={!allowCar}
          onChange={(v) => setAllowCar(!v)}
          label="🚗 자동차는 안 타요 (먼 거리도 도보/대중교통으로만 계산해요)"
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={handleStart} disabled={loading} className="btn btn-primary">
          {loading ? "확인 중..." : "분석 시작"}
        </button>
      </div>
    </div>
  );
}
