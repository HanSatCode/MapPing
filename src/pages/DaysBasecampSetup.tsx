import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Autocomplete, useJsApiLoader } from "@react-google-maps/api";
import { ProgressBar } from "../components/ProgressBar";
import { LoadingScreen } from "../components/LoadingScreen";
import { useWizard } from "../lib/WizardContext";
import { geocodePlace, hasMapsKey, MAPS_LIBRARIES, MAPS_SCRIPT_ID } from "../lib/geocode";
import { parsePlacesFromText, type ParsePlacesProgress } from "../lib/parsePlaces";
import { demoDelay } from "../lib/demoMode";
import { WIZARD_STEPS } from "../lib/wizardSteps";
import { getDestination } from "../lib/destinations";
import { Toggle } from "../components/Toggle";

export default function DaysBasecampSetup() {
  const navigate = useNavigate();
  const { rawText, destination, days, setDays, basecamp, setBasecamp, basecampUndecided, setBasecampUndecided, allowCar, setAllowCar, setPlaces } = useWizard();
  const destinationCenter = getDestination(destination);
  const [basecampName, setBasecampName] = useState(basecamp?.name ?? "");
  const [pickedPlace, setPickedPlace] = useState<{ address?: string; lat: number; lng: number } | null>(
    basecamp ? { address: basecamp.address, lat: basecamp.lat, lng: basecamp.lng } : null
  );
  const [loading, setLoading] = useState(false);
  const [foundCount, setFoundCount] = useState<number | null>(null);
  const [parseProgress, setParseProgress] = useState<ParsePlacesProgress | null>(null);
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

    if (!rawText.trim()) {
      navigate("/new/input");
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

    const center = getDestination(destination);
    const [places] = await Promise.all([
      parsePlacesFromText(rawText, center, setParseProgress),
      demoDelay(),
    ]);
    if (places.length === 0) {
      setLoading(false);
      setParseProgress(null);
      alert("장소를 찾지 못했어요. 텍스트를 다시 확인해주세요.");
      navigate("/new/input");
      return;
    }
    setPlaces(places);
    setFoundCount(places.length);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    navigate("/new/theme");
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

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button onClick={() => navigate(-1)} disabled={loading} className="btn btn-secondary">
          ← 뒤로
        </button>
        <button onClick={handleStart} disabled={loading} className="btn btn-primary">
          {loading ? "확인 중..." : "분석 시작"}
        </button>
      </div>

      {loading &&
        foundCount === null &&
        createPortal(
          <LoadingScreen
            message="장소를 찾고 있어요"
            subMessage={
              parseProgress?.phase === "resolving" && parseProgress.total > 0
                ? `장소 확인 중 (${parseProgress.done}/${parseProgress.total})`
                : "장소명, 좌표, 가격 수준을 추출하고 있어요"
            }
            ticks={["텍스트 조각을 분석하고 있어요", "장소명을 인식하고 있어요", "좌표를 계산하고 있어요", "가격대를 추정하고 있어요"]}
          />,
          document.body
        )}

      {foundCount !== null &&
        createPortal(
          <div className="page-fade loading-overlay" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
            <div className="pop-in loading-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: "var(--text)" }}>
                총 {foundCount}개의 장소를 찾았어요!
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
                이제 꼭 가고 싶은 곳을 골라볼까요?
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
