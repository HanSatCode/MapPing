import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Autocomplete, useJsApiLoader } from "@react-google-maps/api";
import { ProgressBar } from "../components/ProgressBar";
import { useWizard } from "../lib/WizardContext";
import { CATEGORY_LIST } from "../lib/generate";
import { WIZARD_STEPS } from "../lib/wizardSteps";
import { getDestination } from "../lib/destinations";
import { geocodePlace, hasMapsKey, MAPS_LIBRARIES, MAPS_SCRIPT_ID } from "../lib/geocode";
import { categoryFromGoogleTypes, guessCategory, seededPriceLevel } from "../lib/parsePlaces";
import type { Category, ParsedPlace } from "../types";

const CATEGORY_ICON: Record<Category, string> = {
  쇼핑: "🛍️",
  먹거리: "🍜",
  관광: "🏞️",
  카페: "☕",
  숙소: "🏨",
  기타: "✨",
};

const CATEGORY_ORDER: Category[] = ["쇼핑", "먹거리", "카페", "관광", "숙소", "기타"];

function groupPlacesByCategory(places: ParsedPlace[]): [Category, ParsedPlace[]][] {
  const groups = new Map<Category, ParsedPlace[]>();
  for (const place of places) {
    if (!groups.has(place.category)) groups.set(place.category, []);
    groups.get(place.category)!.push(place);
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => [c, groups.get(c)!]);
}

export default function ThemeSelection() {
  const navigate = useNavigate();
  const { destination, places, setPlaces, days, dayThemes, setDayThemes, notes, setNotes } = useWizard();
  const destinationCenter = getDestination(destination);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [adding, setAdding] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? "",
    id: MAPS_SCRIPT_ID,
    libraries: MAPS_LIBRARIES,
  });

  const toggleMustVisit = (id: string) => {
    setPlaces(places.map((p) => (p.id === id ? { ...p, mustVisit: !p.mustVisit } : p)));
  };

  const removePlace = (id: string) => {
    setPlaces(places.filter((p) => p.id !== id));
  };

  const addPlaceFromAutocomplete = () => {
    const place = autocompleteRef.current?.getPlace();
    if (!place?.geometry?.location) return;
    const name = place.name || newPlaceName;
    const newPlace: ParsedPlace = {
      id: crypto.randomUUID(),
      googlePlaceId: place.place_id,
      name,
      address: place.formatted_address,
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
      priceLevel: (place.price_level as 1 | 2 | 3 | 4 | undefined) ?? seededPriceLevel(name),
      category: categoryFromGoogleTypes(place.types) ?? guessCategory(name),
      mustVisit: false,
    };
    setPlaces([...places, newPlace]);
    setNewPlaceName("");
  };

  const addPlaceManually = async () => {
    const name = newPlaceName.trim();
    if (!name) return;
    setAdding(true);
    const geo = await geocodePlace(name, destinationCenter);
    const newPlace: ParsedPlace = {
      id: crypto.randomUUID(),
      name,
      address: geo.address,
      lat: geo.lat,
      lng: geo.lng,
      priceLevel: seededPriceLevel(name),
      category: guessCategory(name),
      mustVisit: false,
    };
    setPlaces([...places, newPlace]);
    setNewPlaceName("");
    setAdding(false);
  };

  useEffect(() => {
    if (dayThemes.length !== days) {
      const next = Array.from({ length: days }, (_, i) => ({
        dayIndex: i + 1,
        theme: dayThemes[i]?.theme ?? CATEGORY_LIST[i % CATEGORY_LIST.length],
      }));
      setDayThemes(next);
    }
  }, [days]);

  const groupedPlaces = groupPlacesByCategory(places);
  const currentCategory = groupedPlaces.some(([c]) => c === activeCategory) ? activeCategory : groupedPlaces[0]?.[0] ?? null;
  const currentGroup = groupedPlaces.find(([c]) => c === currentCategory)?.[1] ?? [];

  const updateTheme = (dayIndex: number, theme: Category | null) => {
    setDayThemes(dayThemes.map((dt) => (dt.dayIndex === dayIndex ? { ...dt, theme } : dt)));
  };

  const handleGenerate = () => {
    if (dayThemes.length === 0) return;
    navigate("/new/generating");
  };

  return (
    <div className="page-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px", width: "100%" }}>
      <ProgressBar steps={WIZARD_STEPS} currentIndex={3} />
      <div
        className="pop-in"
        style={{
          background: "var(--primary-light)",
          border: "1px solid #c7d6fb",
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 28,
          fontSize: 14,
          color: "var(--primary-dark)",
          fontWeight: 600,
        }}
      >
        🎉 총 {places.length}개의 장소를 성공적으로 찾았어요!
      </div>

      <h2 style={{ marginBottom: 8, fontSize: 22 }}>꼭 가고 싶은 곳이 있나요?</h2>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 14 }}>
        모든 곳을 다 갈 수는 없으니, 하루에 소화하기 어려울 만큼 많으면 우선순위가 낮은 곳부터 빠질 수 있어요. 꼭 가고 싶은 곳을 표시해주세요.
      </p>
      {groupedPlaces.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {groupedPlaces.map(([category, group]) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className="pill"
              style={{
                border: category === currentCategory ? "none" : "1px solid var(--border)",
                background: category === currentCategory ? "var(--primary)" : "#fff",
                color: category === currentCategory ? "#fff" : "var(--text-muted)",
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {CATEGORY_ICON[category]} {category} {group.length}
            </button>
          ))}
        </div>
      )}

      {currentCategory && (
        <div key={currentCategory} className="card" style={{ padding: "6px 18px", marginBottom: 20, maxHeight: 280, overflowY: "auto" }}>
          {currentGroup.map((place, i) => (
            <div
              key={place.id}
              className="fade-in"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 0",
                borderBottom: i < currentGroup.length - 1 ? "1px solid var(--border)" : "none",
                animationDelay: `${i * 40}ms`,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{place.name}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => toggleMustVisit(place.id)}
                  className="pill"
                  style={{
                    border: place.mustVisit ? "none" : "1px solid var(--border)",
                    background: place.mustVisit ? "var(--primary)" : "#fff",
                    color: place.mustVisit ? "#fff" : "var(--text-muted)",
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {place.mustVisit ? "⭐ 꼭 갈래요" : "꼭 가고 싶어요"}
                </button>
                <button
                  onClick={() => removePlace(place.id)}
                  aria-label={`${place.name} 삭제`}
                  className="btn-ghost"
                  style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, padding: "4px 6px", color: "var(--text-muted)" }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {places.length === 0 && (
        <div className="card" style={{ padding: "16px 18px", marginBottom: 20, color: "#adb5bd" }}>
          추가된 장소가 없어요. 아래에서 장소를 추가해보세요.
        </div>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 32 }}>
        <label style={{ display: "block", fontWeight: 700, marginBottom: 10, fontSize: 14 }}>깜빡한 장소가 있나요? 추가해보세요</label>
        <div style={{ display: "flex", gap: 8 }}>
          {hasMapsKey && isLoaded ? (
            <Autocomplete
              onLoad={(ac) => (autocompleteRef.current = ac)}
              onPlaceChanged={addPlaceFromAutocomplete}
              options={{
                fields: ["name", "formatted_address", "geometry", "place_id", "types", "price_level"],
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
                value={newPlaceName}
                onChange={(e) => setNewPlaceName(e.target.value)}
                placeholder="장소 이름 또는 주소 검색"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 14, boxSizing: "border-box" }}
              />
            </Autocomplete>
          ) : (
            <>
              <input
                type="text"
                value={newPlaceName}
                onChange={(e) => setNewPlaceName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPlaceManually()}
                placeholder="장소 이름 입력"
                style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 14 }}
              />
              <button onClick={addPlaceManually} disabled={adding || !newPlaceName.trim()} className="btn btn-secondary" style={{ padding: "10px 18px" }}>
                {adding ? "추가 중..." : "추가"}
              </button>
            </>
          )}
        </div>
      </div>

      <h2 style={{ marginBottom: 10, fontSize: 16 }}>추가로 원하는 게 있나요? (선택)</h2>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="예: 맛집 위주로 다녀보고 싶어요 / 실내 위주로 짜주세요"
        rows={3}
        className="card"
        style={{ width: "100%", padding: "12px 14px", fontSize: 14, marginBottom: 32, resize: "vertical", boxSizing: "border-box", border: "1px solid var(--border)" }}
      />

      <h2 style={{ marginBottom: 18, fontSize: 22 }}>일차별 테마를 선택해주세요</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
        {dayThemes.map((dt, idx) => (
          <div
            key={dt.dayIndex}
            className="card pop-in"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", animationDelay: `${idx * 60}ms` }}
          >
            <span style={{ fontWeight: 700 }}>{dt.dayIndex}일차</span>
            <select
              value={dt.theme ?? ""}
              onChange={(e) => updateTheme(dt.dayIndex, e.target.value === "" ? null : (e.target.value as Category))}
              style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 14, background: "#fff" }}
            >
              <option value="">🗓️ 없음 (자유롭게 채우기)</option>
              {CATEGORY_LIST.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_ICON[c]} {c}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={handleGenerate} className="btn btn-primary">
          일정 생성
        </button>
      </div>
    </div>
  );
}
