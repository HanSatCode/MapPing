import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Autocomplete, useJsApiLoader } from "@react-google-maps/api";
import { ProgressBar } from "../components/ProgressBar";
import { LoadingScreen } from "../components/LoadingScreen";
import { useWizard } from "../lib/WizardContext";
import {
  CATEGORY_LIST,
  buildItineraryDays,
  computeCentroid,
  haversineKm,
  computeDailyTransitBudget,
  refineVisitsWithRealTravelTimes,
  refineReturnLegWithRealTravelTime,
  maxWalkMinutesToKm,
  trimDayToTimeBudget,
  DEFAULT_DAY_START_TIME,
  DEFAULT_DAY_END_TIME_TARGET,
} from "../lib/generate";
import { interpretNotes, recommendAiPlaces } from "../lib/notesInterpreter";
import { applyDayAreaConstraints, applyDayPlaceRequests } from "../lib/areaConstraint";
import { WIZARD_STEPS } from "../lib/wizardSteps";
import { getDestination } from "../lib/destinations";
import { geocodePlace, fetchPlaceDetails, hasMapsKey, MAPS_LIBRARIES, MAPS_SCRIPT_ID } from "../lib/geocode";
import { categoryFromGoogleTypes, guessCategory, seededPriceLevel } from "../lib/parsePlaces";
import { generateItineraryTitle } from "../lib/gemini";
import { generateDayCuration } from "../lib/curation";
import { saveItinerary } from "../lib/storage";
import { demoDelay } from "../lib/demoMode";
import { MarqueeText } from "../components/MarqueeText";
import type { Category, Itinerary, ParsedPlace } from "../types";

// AI가 엉뚱한 지역(동명이인 지명 등)을 추천했을 때 걸러내기 위한 여행지 중심 반경(km)
const MAX_AI_PLACE_DISTANCE_KM = 60;

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
  for (const group of groups.values()) {
    group.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => [c, groups.get(c)!]);
}

export default function ThemeSelection() {
  const navigate = useNavigate();
  const { rawText, destination, places, setPlaces, basecamp, basecampUndecided, days, dayThemes, setDayThemes, notes, setNotes, allowCar, reset } = useWizard();
  const destinationCenter = getDestination(destination);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [adding, setAdding] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedItinerary, setGeneratedItinerary] = useState<Itinerary | null>(null);
  const [pulse, setPulse] = useState<{ id: string; type: "heart" | "reject" } | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? "",
    id: MAPS_SCRIPT_ID,
    libraries: MAPS_LIBRARIES,
  });

  const toggleMustVisit = (id: string) => {
    const target = places.find((p) => p.id === id);
    const nextMustVisit = !target?.mustVisit;
    setPlaces(places.map((p) => (p.id === id ? { ...p, mustVisit: nextMustVisit, excluded: nextMustVisit ? false : p.excluded } : p)));
    if (nextMustVisit) {
      setPulse({ id, type: "heart" });
      window.setTimeout(() => setPulse((prev) => (prev?.id === id ? null : prev)), 220);
    }
  };

  const toggleExcluded = (id: string) => {
    const target = places.find((p) => p.id === id);
    const nextExcluded = !target?.excluded;
    setPlaces(places.map((p) => (p.id === id ? { ...p, excluded: nextExcluded, mustVisit: nextExcluded ? false : p.mustVisit } : p)));
    if (nextExcluded) {
      setPulse({ id, type: "reject" });
      window.setTimeout(() => setPulse((prev) => (prev?.id === id ? null : prev)), 220);
    }
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
    try {
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
    } catch (err) {
      console.warn("장소 추가 실패", err);
      alert("장소를 추가하지 못했어요. 다시 시도해주세요.");
    } finally {
      setAdding(false);
    }
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
  const isSearching = searchQuery.trim().length > 0;
  const currentGroup = isSearching
    ? [...places].sort((a, b) => a.name.localeCompare(b.name, "ko")).filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : groupedPlaces.find(([c]) => c === currentCategory)?.[1] ?? [];

  const updateTheme = (dayIndex: number, theme: Category | null) => {
    setDayThemes(dayThemes.map((dt) => (dt.dayIndex === dayIndex ? { ...dt, theme } : dt)));
  };

  const handleGenerate = async () => {
    if (dayThemes.length === 0 || places.length === 0) return;

    setGenerating(true);
    try {
      await runGenerate();
    } catch (err) {
      console.warn("일정 생성 실패", err);
      alert("일정을 생성하지 못했어요. 잠시 후 다시 시도해주세요.");
      setGenerating(false);
    }
  };

  const runGenerate = async () => {
    const includedInputPlaces = places.filter((p) => !p.excluded);
    const [interpretation] = await Promise.all([interpretNotes(notes, includedInputPlaces, days), demoDelay()]);

    const placesWithNotes =
      interpretation && interpretation.mustVisitIds.length > 0
        ? includedInputPlaces.map((p) => (interpretation.mustVisitIds.includes(p.id) ? { ...p, mustVisit: true } : p))
        : includedInputPlaces;

    const destinationInfo = getDestination(destination);
    const locationContext = basecamp?.name || basecamp?.address;
    const aiRecommendations = await recommendAiPlaces(destinationInfo.label, placesWithNotes, notes, days, locationContext);

    const aiPlaces: ParsedPlace[] = await Promise.all(
      aiRecommendations.map(async (rec) => {
        const [geo, details] = await Promise.all([
          geocodePlace(rec.name, destinationInfo),
          fetchPlaceDetails(rec.name, destinationInfo),
        ]);
        const place: ParsedPlace = {
          id: crypto.randomUUID(),
          googlePlaceId: details?.placeId,
          name: rec.name,
          address: geo.address,
          lat: geo.lat,
          lng: geo.lng,
          priceLevel: seededPriceLevel(rec.name),
          estimatedCostJPY: rec.estimatedCostJPY,
          category: rec.category,
          mustVisit: false,
          aiRecommended: true,
          aiReason: rec.reason,
        };
        return place;
      })
    );

    const nearbyAiPlaces = aiPlaces.filter((p) => haversineKm(destinationInfo, p) <= MAX_AI_PLACE_DISTANCE_KM);
    const allPlaces = [...placesWithNotes, ...nearbyAiPlaces];

    const recommendedCenter = basecampUndecided ? computeCentroid(allPlaces) : null;
    const startPoint = basecamp ?? recommendedCenter ?? computeCentroid(allPlaces);
    const { itineraryDays: builtDays, excludedPlaces } = buildItineraryDays(
      allPlaces,
      dayThemes,
      startPoint,
      interpretation?.dayCapacity,
      allowCar,
      interpretation?.maxWalkMinutes ? maxWalkMinutesToKm(interpretation.maxWalkMinutes) : undefined
    );
    const excludedIds = new Set(excludedPlaces.map((p) => p.id));
    const includedPlaces = allPlaces.filter((p) => !excludedIds.has(p.id));

    let itineraryDays = await Promise.all(
      builtDays.map(async (day) => {
        const refinedVisits = await refineVisitsWithRealTravelTimes(day.visits, includedPlaces, startPoint);
        const lastPlace = refinedVisits.length > 0 ? includedPlaces.find((p) => p.id === refinedVisits[refinedVisits.length - 1].placeId) : undefined;
        const refinedReturnLeg = await refineReturnLegWithRealTravelTime(day.returnLeg, lastPlace, startPoint);

        // 페이스를 명시적으로 요청하지 않은 날은 개수가 아니라 귀가 목표 시각으로 채워지는데,
        // 실제 이동시간으로 보정하고 나면 목표 시각을 넘길 수 있어 여기서 한 번 더 다듬는다.
        if (interpretation?.dayCapacity == null) {
          const trimmedResult = await trimDayToTimeBudget(
            refinedVisits,
            includedPlaces,
            startPoint,
            refinedReturnLeg,
            allowCar,
            interpretation?.maxWalkMinutes ? maxWalkMinutesToKm(interpretation.maxWalkMinutes) : undefined,
            day.startTime ?? DEFAULT_DAY_START_TIME,
            day.endTimeTarget ?? DEFAULT_DAY_END_TIME_TARGET
          );
          return {
            ...day,
            visits: trimmedResult.visits,
            returnLeg: trimmedResult.returnLeg,
            dailyTransitBudget: computeDailyTransitBudget(trimmedResult.visits, trimmedResult.returnLeg),
          };
        }

        return {
          ...day,
          visits: refinedVisits,
          returnLeg: refinedReturnLeg,
          dailyTransitBudget: computeDailyTransitBudget(refinedVisits, refinedReturnLeg),
        };
      })
    );

    let finalPlaces = allPlaces;
    if (interpretation?.dayAreaConstraints && interpretation.dayAreaConstraints.length > 0) {
      const applied = await applyDayAreaConstraints(
        interpretation.dayAreaConstraints,
        itineraryDays,
        allPlaces,
        destinationInfo,
        startPoint,
        allowCar,
        notes,
        destinationInfo.label
      );
      itineraryDays = applied.itineraryDays;
      finalPlaces = applied.allPlaces;
    }
    if (interpretation?.dayPlaceRequests && interpretation.dayPlaceRequests.length > 0) {
      const applied = await applyDayPlaceRequests(
        interpretation.dayPlaceRequests,
        itineraryDays,
        finalPlaces,
        destinationInfo,
        startPoint,
        allowCar
      );
      itineraryDays = applied.itineraryDays;
      finalPlaces = applied.allPlaces;
    }

    const usedPlaceIds = new Set(itineraryDays.flatMap((d) => d.visits.map((v) => v.placeId)));
    const finalIncludedPlaces = finalPlaces.filter((p) => usedPlaceIds.has(p.id));
    const finalExcludedPlaces = finalPlaces.filter((p) => !usedPlaceIds.has(p.id));

    const aiTitle = await generateItineraryTitle(
      destinationInfo.label,
      days,
      finalIncludedPlaces.map((p) => p.name)
    );

    const placesById = new Map(finalIncludedPlaces.map((p) => [p.id, p]));
    const itineraryDaysWithCuration = await Promise.all(
      itineraryDays.map(async (day) => {
        if (day.visits.length === 0) return day;
        const curation = await generateDayCuration(destinationInfo.label, day, placesById, notes, days);
        return { ...day, curation };
      })
    );

    const itinerary: Itinerary = {
      id: crypto.randomUUID(),
      title: aiTitle || `${days}일 여행 일정`,
      rawInputText: rawText,
      notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      days,
      basecamp,
      basecampUndecided,
      recommendedCenter,
      places: finalIncludedPlaces,
      excludedPlaces: finalExcludedPlaces,
      dayThemes,
      itineraryDays: itineraryDaysWithCuration,
      budgetOverrides: [],
      destinationLabel: destinationInfo.label,
      allowCar,
    };

    saveItinerary(itinerary);
    setGeneratedItinerary(itinerary);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    reset();
    navigate(`/result/${itinerary.id}`);
  };

  return (
    <div className="page-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px", width: "100%" }}>
      <ProgressBar steps={WIZARD_STEPS} currentIndex={3} />
      <h2 style={{ marginBottom: 8, fontSize: 22 }}>꼭 가고 싶은 곳이 있나요?</h2>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 14 }}>
        모든 곳을 다 갈 수는 없으니, 하루에 소화하기 어려울 만큼 많으면 우선순위가 낮은 곳부터 빠질 수 있어요. 꼭 가고 싶은 곳을 표시해주세요.
      </p>
      {groupedPlaces.length > 0 && (
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 장소 이름으로 검색"
          style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 14, marginBottom: 10, boxSizing: "border-box" }}
        />
      )}
      {groupedPlaces.length > 0 && !isSearching && (
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

      {(currentCategory || isSearching) && (
        <div key={isSearching ? "search" : currentCategory} className="card" style={{ padding: "6px 18px", marginBottom: 20, maxHeight: 280, overflowY: "auto" }}>
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
                opacity: place.excluded ? 0.5 : 1,
              }}
            >
              <div style={{ minWidth: 0, flex: 1, marginRight: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <MarqueeText text={place.name} style={{ fontWeight: 700, fontSize: 14 }} />
                {isSearching && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                    {CATEGORY_ICON[place.category]} {place.category}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => toggleMustVisit(place.id)}
                  className={`pill${pulse?.id === place.id && pulse.type === "heart" ? " heart-beat" : ""}`}
                  style={{
                    border: place.mustVisit ? "none" : "1px solid var(--border)",
                    background: place.mustVisit ? "linear-gradient(135deg, #ff8fa3, #ff4d6d)" : "#fff",
                    color: place.mustVisit ? "#fff" : "var(--text-muted)",
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: place.mustVisit ? "0 4px 12px rgba(255,77,109,0.4)" : "none",
                  }}
                >
                  {place.mustVisit ? "❤️ 꼭 가고 싶어요" : "꼭 가고 싶어요"}
                </button>
                <button
                  onClick={() => toggleExcluded(place.id)}
                  aria-label={`${place.name} ${place.excluded ? "다시 포함" : "제외"}`}
                  className={`pill${pulse?.id === place.id && pulse.type === "reject" ? " reject-shake" : ""}`}
                  style={{
                    border: place.excluded ? "none" : "1px solid var(--border)",
                    background: place.excluded ? "linear-gradient(135deg, #868e96, #495057)" : "#fff",
                    color: place.excluded ? "#fff" : "var(--text-muted)",
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    boxShadow: place.excluded ? "0 4px 12px rgba(73,80,87,0.35)" : "none",
                  }}
                >
                  {place.excluded ? "🙅 여기는 안 갈래요" : "여기는 안 갈래요"}
                </button>
              </div>
            </div>
          ))}
          {currentGroup.length === 0 && searchQuery.trim() && (
            <div style={{ padding: "24px 0", textAlign: "center", color: "#adb5bd", fontSize: 14 }}>
              "{searchQuery}"에 해당하는 장소가 없어요.
            </div>
          )}
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
            <>
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
              <button onClick={addPlaceFromAutocomplete} disabled={!newPlaceName.trim()} className="btn btn-secondary" style={{ padding: "10px 18px", flexShrink: 0 }}>
                추가
              </button>
            </>
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

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button onClick={() => navigate(-1)} disabled={generating} className="btn btn-secondary">
          ← 뒤로
        </button>
        <button onClick={handleGenerate} disabled={generating} className="btn btn-primary">
          {generating ? "생성 중..." : "일정 생성"}
        </button>
      </div>

      {generating &&
        !generatedItinerary &&
        createPortal(
          <LoadingScreen
            message={"테마에 맞춰 동선을 최적화하고\n예산을 계산하고 있어요"}
            subMessage="잠시만 기다려주세요"
            ticks={["일차별로 장소를 배분하고 있어요", "최적 동선을 계산하고 있어요", "이동 시간과 교통비를 산출하고 있어요", "예산을 정리하고 있어요", "AI 큐레이션을 작성하고 있어요"]}
          />,
          document.body
        )}

      {generatedItinerary &&
        createPortal(
          <div className="page-fade loading-overlay" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
            <div className="pop-in loading-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: "var(--text)" }}>
                테마에 맞춰 {generatedItinerary.days}일 일정을 완성했어요!
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
                {generatedItinerary.title}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
