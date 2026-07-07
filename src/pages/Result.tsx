import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Autocomplete, useJsApiLoader } from "@react-google-maps/api";
import { getItinerary, getPlaceBudget, saveItinerary, setPlaceBudget, computeTotalBudget } from "../lib/storage";
import {
  recomputeVisitsForOrder,
  computeCentroid,
  computeReturnLeg,
  computeDailyTransitBudget,
  computeDayTimeline,
  buildItineraryDays,
  timeToMinutes,
  haversineKm,
  refineVisitsWithRealTravelTimes,
  refineReturnLegWithRealTravelTime,
  DEFAULT_DAY_START_TIME,
  DEFAULT_DAY_END_TIME_TARGET,
  STAY_MINUTES,
  CATEGORY_LIST,
} from "../lib/generate";
import { geocodePlace, fetchPlaceDetails, hasMapsKey, MAPS_LIBRARIES, MAPS_SCRIPT_ID } from "../lib/geocode";
import { categoryFromGoogleTypes, guessCategory, seededPriceLevel } from "../lib/parsePlaces";
import { interpretNotes, recommendAiPlaces } from "../lib/notesInterpreter";
import { MapView, type MapPin } from "../components/MapView";
import { MarqueeText } from "../components/MarqueeText";
import { Toggle } from "../components/Toggle";
import type { Category, Itinerary, ParsedPlace, PlaceVisit } from "../types";

const TRANSPORT_LABEL: Record<string, string> = { walk: "도보", transit: "대중교통", car: "자동차" };

const CATEGORY_COLOR: Record<string, string> = {
  쇼핑: "linear-gradient(135deg, #f5a623, #e8871e)",
  먹거리: "linear-gradient(135deg, #ff7a59, #e8543c)",
  관광: "linear-gradient(135deg, #3b6df0, #5b7ff5)",
  카페: "linear-gradient(135deg, #a56b3f, #8a5630)",
  숙소: "linear-gradient(135deg, #8e5bde, #6f42c1)",
  기타: "linear-gradient(135deg, #6c757d, #545b62)",
};

function formatJPY(amount: number) {
  return `¥${Math.round(amount).toLocaleString("ko-KR")}`;
}

// AI가 엉뚱한 지역(동명이인 지명 등)을 추천했을 때 걸러내기 위한 여행지 중심 반경(km)
const MAX_AI_PLACE_DISTANCE_KM = 60;

function formatKRW(amount: number) {
  return `₩${Math.round(amount).toLocaleString("ko-KR")}`;
}

const DEFAULT_EXCHANGE_RATE = 9.5;

export default function Result() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [tab, setTab] = useState<"route" | "budget">("route");
  const [selectedDay, setSelectedDay] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [exchangeRateInput, setExchangeRateInput] = useState(String(DEFAULT_EXCHANGE_RATE));
  const [excludedCategoryFilter, setExcludedCategoryFilter] = useState<string | null>(null);
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null);
  const [showReanalyzeModal, setShowReanalyzeModal] = useState(false);
  const [reanalyzeNotesInput, setReanalyzeNotesInput] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? "",
    id: MAPS_SCRIPT_ID,
    libraries: MAPS_LIBRARIES,
  });

  useEffect(() => {
    if (!id) return;
    const found = getItinerary(id);
    if (!found) {
      navigate("/dashboard");
      return;
    }
    setItinerary(found);
    setSelectedDay(found.itineraryDays[0]?.dayIndex ?? 1);
    setExchangeRateInput(String(found.exchangeRate ?? DEFAULT_EXCHANGE_RATE));
    setReanalyzeNotesInput(found.notes);
  }, [id]);

  const placeById = useMemo(() => {
    const map = new Map<string, ParsedPlace>();
    itinerary?.places.forEach((p) => map.set(p.id, p));
    return map;
  }, [itinerary]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const excludedByCategory = useMemo(() => {
    const map = new Map<string, ParsedPlace[]>();
    itinerary?.excludedPlaces.forEach((p) => {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    });
    return Array.from(map.entries());
  }, [itinerary]);

  const budgetByCategory = useMemo(() => {
    const map = new Map<string, number>();
    if (!itinerary) return [] as [string, number][];
    for (const place of itinerary.places) {
      const amount = getPlaceBudget(itinerary, place.id);
      map.set(place.category, (map.get(place.category) ?? 0) + amount);
    }
    const transport = itinerary.itineraryDays.reduce((sum, d) => sum + d.dailyTransitBudget, 0);
    if (transport > 0) map.set("교통", (map.get("교통") ?? 0) + transport);
    return Array.from(map.entries());
  }, [itinerary]);

  if (!itinerary) return null;

  const currentDay = itinerary.itineraryDays.find((d) => d.dayIndex === selectedDay);
  const startPoint = itinerary.basecamp ?? itinerary.recommendedCenter ?? computeCentroid(itinerary.places);
  const allowCar = itinerary.allowCar ?? true;
  const dayTimeline = currentDay
    ? computeDayTimeline(currentDay.visits, itinerary.places, currentDay.returnLeg, currentDay.startTime ?? DEFAULT_DAY_START_TIME)
    : null;
  const timelineByPlaceId = new Map(dayTimeline?.stops.map((s) => [s.placeId, s]) ?? []);
  const effectiveEndTimeTarget = currentDay?.endTimeTarget ?? DEFAULT_DAY_END_TIME_TARGET;

  const withPreservedStayMinutes = (oldVisits: PlaceVisit[], newVisits: PlaceVisit[]): PlaceVisit[] => {
    const stayById = new Map(oldVisits.filter((v) => v.stayMinutes !== undefined).map((v) => [v.placeId, v.stayMinutes]));
    return newVisits.map((v) => (stayById.has(v.placeId) ? { ...v, stayMinutes: stayById.get(v.placeId) } : v));
  };

  // 순서/장소가 바뀐 뒤 직선거리 추정치로 우선 계산하고, 구글 지도 API로 실제 이동시간/비용을 다시 보정한다
  const refineDay = async (visits: PlaceVisit[], places: ParsedPlace[]) => {
    const refinedVisits = await refineVisitsWithRealTravelTimes(visits, places, startPoint);
    const lastPlace = refinedVisits.length > 0 ? places.find((p) => p.id === refinedVisits[refinedVisits.length - 1].placeId) : undefined;
    const heuristicReturnLeg = computeReturnLeg(refinedVisits, places, startPoint, allowCar);
    const refinedReturnLeg = await refineReturnLegWithRealTravelTime(heuristicReturnLeg, lastPlace, startPoint);
    return { visits: refinedVisits, returnLeg: refinedReturnLeg, dailyTransitBudget: computeDailyTransitBudget(refinedVisits, refinedReturnLeg) };
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !currentDay) return;

    const oldIndex = currentDay.visits.findIndex((v) => v.placeId === active.id);
    const newIndex = currentDay.visits.findIndex((v) => v.placeId === over.id);
    const reorderedIds = arrayMove(currentDay.visits, oldIndex, newIndex).map((v) => v.placeId);
    const heuristicVisits = withPreservedStayMinutes(currentDay.visits, recomputeVisitsForOrder(reorderedIds, itinerary.places, startPoint, allowCar));
    const refined = await refineDay(heuristicVisits, itinerary.places);

    setItinerary((prev) =>
      prev
        ? {
            ...prev,
            itineraryDays: prev.itineraryDays.map((d) => (d.dayIndex === selectedDay ? { ...d, ...refined } : d)),
          }
        : prev
    );
    setDirty(true);
  };

  const handleDeletePlace = async (placeId: string) => {
    const place = placeById.get(placeId);
    if (!place) return;
    if (!confirm(`${place.name}을(를) 일정에서 삭제할까요?`)) return;

    const newPlaces = itinerary.places.filter((p) => p.id !== placeId);
    const affectedDay = itinerary.itineraryDays.find((d) => d.visits.some((v) => v.placeId === placeId));

    let refined: Awaited<ReturnType<typeof refineDay>> | null = null;
    if (affectedDay) {
      const orderedIds = affectedDay.visits.filter((v) => v.placeId !== placeId).map((v) => v.placeId);
      const heuristicVisits = withPreservedStayMinutes(affectedDay.visits, recomputeVisitsForOrder(orderedIds, newPlaces, startPoint, allowCar));
      refined = await refineDay(heuristicVisits, newPlaces);
    }

    setItinerary((prev) =>
      prev
        ? {
            ...prev,
            places: newPlaces,
            itineraryDays: prev.itineraryDays.map((d) => (d.dayIndex === affectedDay?.dayIndex && refined ? { ...d, ...refined } : d)),
            budgetOverrides: prev.budgetOverrides.filter((o) => o.placeId !== placeId),
          }
        : prev
    );
    setDirty(true);
  };

  const addPlaceToDay = async (newPlace: ParsedPlace) => {
    const newPlaces = [...itinerary.places, newPlace];
    const targetDay = itinerary.itineraryDays.find((d) => d.dayIndex === selectedDay);
    if (!targetDay) return;

    const orderedIds = [...targetDay.visits.map((v) => v.placeId), newPlace.id];
    const heuristicVisits = withPreservedStayMinutes(targetDay.visits, recomputeVisitsForOrder(orderedIds, newPlaces, startPoint, allowCar));
    const refined = await refineDay(heuristicVisits, newPlaces);

    setItinerary((prev) =>
      prev
        ? {
            ...prev,
            places: newPlaces,
            itineraryDays: prev.itineraryDays.map((d) => (d.dayIndex === selectedDay ? { ...d, ...refined } : d)),
          }
        : prev
    );
    setDirty(true);
  };

  const handleAddFromAutocomplete = () => {
    const place = autocompleteRef.current?.getPlace();
    if (!place?.geometry?.location) return;
    const name = place.name || newPlaceName;
    addPlaceToDay({
      id: crypto.randomUUID(),
      googlePlaceId: place.place_id,
      name,
      address: place.formatted_address,
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
      priceLevel: (place.price_level as 1 | 2 | 3 | 4 | undefined) ?? seededPriceLevel(name),
      category: categoryFromGoogleTypes(place.types) ?? guessCategory(name),
      mustVisit: false,
    });
    setNewPlaceName("");
  };

  const handleAddManually = async () => {
    const name = newPlaceName.trim();
    if (!name) return;
    setAdding(true);
    const geo = await geocodePlace(name, startPoint);
    addPlaceToDay({
      id: crypto.randomUUID(),
      name,
      address: geo.address,
      lat: geo.lat,
      lng: geo.lng,
      priceLevel: seededPriceLevel(name),
      category: guessCategory(name),
      mustVisit: false,
    });
    setNewPlaceName("");
    setAdding(false);
  };

  const handleAddFromExcluded = (place: ParsedPlace) => {
    addPlaceToDay(place);
    setItinerary((prev) => (prev ? { ...prev, excludedPlaces: prev.excludedPlaces.filter((p) => p.id !== place.id) } : prev));
  };

  const handleBudgetChange = (placeId: string, value: string) => {
    const amount = Number(value.replace(/[^0-9]/g, "")) || 0;
    const overrides = setPlaceBudget(itinerary, placeId, amount);
    setItinerary({ ...itinerary, budgetOverrides: overrides });
    setDirty(true);
  };

  const handleTravelCostChange = (placeId: string, value: string) => {
    const amount = Number(value.replace(/[^0-9]/g, "")) || 0;
    setItinerary({
      ...itinerary,
      itineraryDays: itinerary.itineraryDays.map((d) => {
        if (d.dayIndex !== selectedDay) return d;
        const newVisits = d.visits.map((v) => (v.placeId === placeId ? { ...v, travelCost: amount } : v));
        return { ...d, visits: newVisits, dailyTransitBudget: computeDailyTransitBudget(newVisits, d.returnLeg) };
      }),
    });
    setDirty(true);
  };

  const handleStayMinutesChange = (placeId: string, value: string) => {
    const minutes = Math.max(0, Number(value.replace(/[^0-9]/g, "")) || 0);
    setItinerary({
      ...itinerary,
      itineraryDays: itinerary.itineraryDays.map((d) => {
        if (d.dayIndex !== selectedDay) return d;
        const newVisits = d.visits.map((v) => (v.placeId === placeId ? { ...v, stayMinutes: minutes } : v));
        return { ...d, visits: newVisits };
      }),
    });
    setDirty(true);
  };

  const handleReturnLegCostChange = (value: string) => {
    const amount = Number(value.replace(/[^0-9]/g, "")) || 0;
    setItinerary({
      ...itinerary,
      itineraryDays: itinerary.itineraryDays.map((d) => {
        if (d.dayIndex !== selectedDay || !d.returnLeg) return d;
        const newReturnLeg = { ...d.returnLeg, travelCost: amount };
        return { ...d, returnLeg: newReturnLeg, dailyTransitBudget: computeDailyTransitBudget(d.visits, newReturnLeg) };
      }),
    });
    setDirty(true);
  };

  const handleTitleChange = (title: string) => {
    setItinerary({ ...itinerary, title });
    setDirty(true);
  };

  const handleStartTimeChange = (value: string) => {
    setItinerary({
      ...itinerary,
      itineraryDays: itinerary.itineraryDays.map((d) => (d.dayIndex === selectedDay ? { ...d, startTime: value } : d)),
    });
    setDirty(true);
  };

  const handleEndTimeTargetChange = (value: string) => {
    setItinerary({
      ...itinerary,
      itineraryDays: itinerary.itineraryDays.map((d) => (d.dayIndex === selectedDay ? { ...d, endTimeTarget: value || undefined } : d)),
    });
    setDirty(true);
  };

  const handleThemeChange = async (dayIndex: number, newTheme: Category | null) => {
    const newDayThemes = itinerary.dayThemes.map((dt) => (dt.dayIndex === dayIndex ? { ...dt, theme: newTheme } : dt));
    const allPlaces = [...itinerary.places, ...itinerary.excludedPlaces];
    const { itineraryDays: builtDays, excludedPlaces } = buildItineraryDays(allPlaces, newDayThemes, startPoint, undefined, allowCar);
    const excludedIds = new Set(excludedPlaces.map((p) => p.id));
    const includedPlaces = allPlaces.filter((p) => !excludedIds.has(p.id));

    const itineraryDays = await Promise.all(
      builtDays.map(async (day) => {
        const refined = await refineDay(day.visits, includedPlaces);
        return { ...day, ...refined };
      })
    );

    setItinerary({
      ...itinerary,
      dayThemes: newDayThemes,
      places: includedPlaces,
      excludedPlaces,
      itineraryDays,
      budgetOverrides: itinerary.budgetOverrides.filter((o) => includedPlaces.some((p) => p.id === o.placeId)),
    });
    setDirty(true);
  };

  const handleAllowCarChange = async (nextAllowCar: boolean) => {
    const allPlaces = [...itinerary.places, ...itinerary.excludedPlaces];
    const { itineraryDays: builtDays, excludedPlaces } = buildItineraryDays(
      allPlaces,
      itinerary.dayThemes,
      startPoint,
      undefined,
      nextAllowCar
    );
    const excludedIds = new Set(excludedPlaces.map((p) => p.id));
    const includedPlaces = allPlaces.filter((p) => !excludedIds.has(p.id));

    const itineraryDays = await Promise.all(
      builtDays.map(async (day) => {
        const refinedVisits = await refineVisitsWithRealTravelTimes(day.visits, includedPlaces, startPoint);
        const lastPlace =
          refinedVisits.length > 0 ? includedPlaces.find((p) => p.id === refinedVisits[refinedVisits.length - 1].placeId) : undefined;
        const refinedReturnLeg = await refineReturnLegWithRealTravelTime(day.returnLeg, lastPlace, startPoint);
        return {
          ...day,
          visits: refinedVisits,
          returnLeg: refinedReturnLeg,
          dailyTransitBudget: computeDailyTransitBudget(refinedVisits, refinedReturnLeg),
        };
      })
    );

    setItinerary({
      ...itinerary,
      allowCar: nextAllowCar,
      places: includedPlaces,
      excludedPlaces,
      itineraryDays,
      budgetOverrides: itinerary.budgetOverrides.filter((o) => includedPlaces.some((p) => p.id === o.placeId)),
    });
    setDirty(true);
  };

  const handleExchangeRateChange = (value: string) => {
    setExchangeRateInput(value);
    const rate = Number(value);
    if (!value.trim() || Number.isNaN(rate) || rate <= 0) return;
    setItinerary({ ...itinerary, exchangeRate: rate });
    setDirty(true);
  };

  const handleReanalyze = async () => {
    const combinedNotes = reanalyzeNotesInput.trim();
    setReanalyzing(true);
    try {
      const interpretation = await interpretNotes(combinedNotes, itinerary.places, itinerary.days);
      const placesWithMustVisit =
        interpretation && interpretation.mustVisitIds.length > 0
          ? itinerary.places.map((p) => (interpretation.mustVisitIds.includes(p.id) ? { ...p, mustVisit: true } : p))
          : itinerary.places;

      const destinationLabel = itinerary.destinationLabel || itinerary.basecamp?.name || itinerary.basecamp?.address || "여행지";
      const locationContext = itinerary.basecamp?.name || itinerary.basecamp?.address;
      const aiRecommendations = await recommendAiPlaces(destinationLabel, placesWithMustVisit, combinedNotes, itinerary.days, locationContext);

      if (!interpretation && aiRecommendations.length === 0) {
        alert("AI 재분석에 실패했어요. API 키 설정 또는 사용량 한도를 확인해주세요.\n(요청사항 텍스트는 저장됩니다.)");
        setItinerary({ ...itinerary, notes: combinedNotes });
        setDirty(true);
        setShowReanalyzeModal(false);
        return;
      }

      const newAiPlaces: ParsedPlace[] = await Promise.all(
        aiRecommendations.map(async (rec) => {
          const [geo, details] = await Promise.all([
            geocodePlace(rec.name, startPoint),
            fetchPlaceDetails(rec.name, startPoint),
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
          };
          return place;
        })
      );

      const nearbyAiPlaces = newAiPlaces.filter((p) => haversineKm(startPoint, p) <= MAX_AI_PLACE_DISTANCE_KM);
      const allPlaces = [...placesWithMustVisit, ...nearbyAiPlaces];
      const { itineraryDays, excludedPlaces } = buildItineraryDays(
        allPlaces,
        itinerary.dayThemes,
        startPoint,
        interpretation?.dayCapacity,
        allowCar
      );
      const excludedIds = new Set(excludedPlaces.map((p) => p.id));
      const includedPlaces = allPlaces.filter((p) => !excludedIds.has(p.id));

      setItinerary({
        ...itinerary,
        notes: combinedNotes,
        places: includedPlaces,
        excludedPlaces,
        itineraryDays,
        budgetOverrides: itinerary.budgetOverrides.filter((o) => includedPlaces.some((p) => p.id === o.placeId)),
      });
      setSelectedDay(itineraryDays[0]?.dayIndex ?? 1);
      setDirty(true);
      setShowReanalyzeModal(false);
    } finally {
      setReanalyzing(false);
    }
  };

  const handleSave = () => {
    saveItinerary(itinerary);
    setDirty(false);
    alert("저장되었습니다.");
  };

  const handleShare = () => {
    const url = `${window.location.origin}/result/${itinerary.id}?shared=1`;
    navigator.clipboard?.writeText(url).catch(() => {});
    alert(`공유 링크가 복사되었습니다:\n${url}`);
  };

  const handleExportTimetable = () => {
    const escapeCsvCell = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

    const header = ["시간", ...itinerary.itineraryDays.map((d) => `${d.dayIndex}일차${d.theme ? ` · ${d.theme}` : ""}`)];

    const dayTimelines = itinerary.itineraryDays.map((day) =>
      computeDayTimeline(day.visits, itinerary.places, day.returnLeg, day.startTime ?? DEFAULT_DAY_START_TIME)
    );

    const rows: string[][] = [];
    for (let hour = 0; hour < 24; hour++) {
      const rangeStart = hour * 60;
      const rangeEnd = rangeStart + 60;
      const row = [`${String(hour).padStart(2, "0")}:00`];
      itinerary.itineraryDays.forEach((_day, dayIdx) => {
        const timeline = dayTimelines[dayIdx];
        const stop = timeline.stops.find((s) => {
          const arrivalMin = timeToMinutes(s.arrival);
          const departureMin = timeToMinutes(s.departure);
          return arrivalMin < rangeEnd && departureMin > rangeStart;
        });
        const place = stop ? placeById.get(stop.placeId) : undefined;
        row.push(place?.name ?? "");
      });
      rows.push(row);
    }

    const csvContent = [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${itinerary.title || "여행일정"}_시간표.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(itinerary, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${itinerary.title || "여행일정"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const totalBudget = computeTotalBudget(itinerary);
  const effectiveExchangeRate = itinerary.exchangeRate ?? DEFAULT_EXCHANGE_RATE;

  const placesForMap =
    tab === "route" && currentDay
      ? currentDay.visits.map((v) => placeById.get(v.placeId)).filter((p): p is ParsedPlace => Boolean(p))
      : itinerary.places;
  const mapPins: MapPin[] = [
    ...placesForMap.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name, kind: "place" as const, googlePlaceId: p.googlePlaceId })),
  ];
  if (itinerary.basecamp) {
    mapPins.push({ id: "basecamp", lat: itinerary.basecamp.lat, lng: itinerary.basecamp.lng, label: "숙소", kind: "basecamp" });
  } else if (itinerary.recommendedCenter) {
    mapPins.push({ id: "recommended", lat: itinerary.recommendedCenter.lat, lng: itinerary.recommendedCenter.lng, label: "추천 중심점", kind: "recommended" });
  }


  return (
    <div className="page-fade with-bottom-nav" style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 24px", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
        <div>
          <input
            value={itinerary.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            style={{ fontSize: 24, fontWeight: 800, border: "none", outline: "none", background: "transparent", padding: 0, minWidth: 200, color: "var(--text)" }}
          />
          <div style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
            {itinerary.days}일 여행 · 총 예산 <b style={{ color: "var(--primary-dark)" }}>{formatJPY(totalBudget)}</b>
          </div>
          <div style={{ marginTop: 10 }}>
            <Toggle checked={!allowCar} onChange={(v) => handleAllowCarChange(!v)} label="🚗 자동차는 안 타요 (도보/대중교통으로만 계산)" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => navigate("/dashboard")} style={secondaryBtn}>대시보드로</button>
          <button onClick={handleExportTimetable} style={secondaryBtn}>시간표 내보내기</button>
          <button onClick={handleExportJson} style={secondaryBtn}>JSON 내보내기</button>
          <button onClick={handleShare} style={secondaryBtn}>공유</button>
          <button onClick={handleSave} style={primaryBtn}>{dirty ? "변경사항 저장" : "저장됨"}</button>
        </div>
      </div>

      {itinerary.basecampUndecided && itinerary.recommendedCenter && (
        <div style={{ background: "#e9fbf3", border: "1px solid #b7ecd8", borderRadius: 12, padding: "14px 18px", marginBottom: 20, fontSize: 14, color: "var(--success)" }}>
          🏠 가고 싶은 곳들이 이 지역에 모여있어요! 지도에 표시된 <b>추천 중심점</b> 근처에 숙소를 잡아보세요.
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "var(--primary-light)",
          border: "1px solid #c7d6fb",
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 20,
          fontSize: 14,
          color: "var(--primary-dark)",
        }}
      >
        <span>{itinerary.notes.trim() ? <>💬 요청사항: {itinerary.notes}</> : "💬 요청사항을 추가하면 AI가 일정을 다시 짜드려요."}</span>
        <button
          onClick={() => setShowReanalyzeModal(true)}
          style={{ flexShrink: 0, padding: "6px 14px", borderRadius: 999, border: "1px solid var(--primary)", background: "#fff", color: "var(--primary-dark)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
        >
          ✨ 재분석
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setTab("route")} style={tabBtn(tab === "route")}>동선</button>
        <button onClick={() => setTab("budget")} style={tabBtn(tab === "budget")}>예산</button>
      </div>

      <div className="result-grid">
        <div key={tab} className="fade-in">
          {tab === "route" && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {itinerary.itineraryDays.map((d) => (
                  <button key={d.dayIndex} onClick={() => setSelectedDay(d.dayIndex)} style={dayBtn(d.dayIndex === selectedDay)}>
                    {d.dayIndex}일차{d.theme ? ` · ${d.theme}` : ""}
                  </button>
                ))}
              </div>

              {currentDay && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    이 날 예상 교통비 <b style={{ color: "var(--text)" }}>{formatJPY(currentDay.dailyTransitBudget)}</b>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)" }}>
                      <span>테마</span>
                      <select
                        value={currentDay.theme ?? ""}
                        onChange={(e) => handleThemeChange(currentDay.dayIndex, e.target.value === "" ? null : (e.target.value as Category))}
                        style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}
                      >
                        <option value="">🗓️ 없음</option>
                        {CATEGORY_LIST.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)" }}>
                      <span>출발 시간</span>
                      <input
                        type="time"
                        value={currentDay.startTime ?? DEFAULT_DAY_START_TIME}
                        onChange={(e) => handleStartTimeChange(e.target.value)}
                        style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)" }}>
                      <span>귀가 시간</span>
                      <input
                        type="time"
                        value={currentDay.endTimeTarget ?? DEFAULT_DAY_END_TIME_TARGET}
                        onChange={(e) => handleEndTimeTargetChange(e.target.value)}
                        style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={currentDay?.visits.map((v) => v.placeId) ?? []} strategy={verticalListSortingStrategy}>
                  <div
                    className="scroll-fade"
                    style={{ display: "flex", flexDirection: "column", gap: 16, maxHeight: 300, overflowY: "auto", padding: "20px 26px", margin: "-20px -26px" }}
                  >
                    {currentDay?.visits.map((visit, idx) => {
                      const place = placeById.get(visit.placeId);
                      if (!place) return null;
                      const stop = timelineByPlaceId.get(visit.placeId);
                      return (
                        <SortableVisitRow
                          key={visit.placeId}
                          id={visit.placeId}
                          index={idx}
                          place={place}
                          placeCost={getPlaceBudget(itinerary, place.id)}
                          travelTimeMin={visit.travelTimeMin}
                          travelCost={visit.travelCost}
                          mode={visit.transportMode}
                          arrival={stop?.arrival}
                          departure={stop?.departure}
                          stayMinutes={visit.stayMinutes ?? STAY_MINUTES[place.category]}
                          delay={idx * 45}
                          focused={focusedPlaceId === visit.placeId}
                          onFocus={() => setFocusedPlaceId(visit.placeId)}
                          onDelete={() => handleDeletePlace(visit.placeId)}
                          onTravelCostChange={(value) => handleTravelCostChange(visit.placeId, value)}
                          onPlaceCostChange={(value) => handleBudgetChange(visit.placeId, value)}
                          onStayMinutesChange={(value) => handleStayMinutesChange(visit.placeId, value)}
                        />
                      );
                    })}
                    {currentDay?.visits.length === 0 && <p style={{ color: "#adb5bd" }}>이 날에 배정된 장소가 없어요.</p>}
                  </div>
                </SortableContext>
              </DndContext>

              {currentDay?.returnLeg && (
                <div
                  className="card"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", marginTop: 10, background: "#f8f9fc" }}
                >
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    🏁 {itinerary.basecamp ? "숙소로 복귀" : "추천 중심점으로 복귀"} · {TRANSPORT_LABEL[currentDay.returnLeg.transportMode]} · {currentDay.returnLeg.travelTimeMin}분
                    {dayTimeline && (
                      <>
                        {" "}
                        · 예상 도착{" "}
                        <b
                          style={{
                            color: timeToMinutes(dayTimeline.endTime) > timeToMinutes(effectiveEndTimeTarget) ? "var(--danger)" : "var(--text)",
                          }}
                        >
                          {dayTimeline.endTime}
                        </b>{" "}
                        (목표 {effectiveEndTimeTarget}
                        {timeToMinutes(dayTimeline.endTime) > timeToMinutes(effectiveEndTimeTarget) ? " 초과!" : ""})
                      </>
                    )}
                  </div>
                  <input
                    value={currentDay.returnLeg.travelCost.toLocaleString("ko-KR")}
                    onChange={(e) => handleReturnLegCostChange(e.target.value)}
                    style={{ width: 100, textAlign: "right", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontWeight: 700, fontSize: 13 }}
                  />
                </div>
              )}

              <button
                onClick={() => setShowAddModal(true)}
                className="btn btn-secondary"
                style={{ width: "100%", marginTop: 16, padding: "12px 16px", borderRadius: 12, fontWeight: 700 }}
              >
                + {selectedDay}일차에 장소 추가하기
              </button>
            </>
          )}

          {tab === "budget" && (
            <div>
              <div
                className="card"
                style={{
                  padding: "20px 24px",
                  marginBottom: 12,
                  background: "linear-gradient(135deg, var(--primary), #5b7ff5)",
                  border: "none",
                  color: "#fff",
                }}
              >
                <div style={{ fontSize: 13, opacity: 0.85 }}>총 예산</div>
                <div style={{ fontSize: 26, fontWeight: 800 }}>{formatJPY(totalBudget)}</div>
                <div style={{ fontSize: 14, opacity: 0.9, marginTop: 2 }}>≈ {formatKRW(totalBudget * effectiveExchangeRate)}</div>
              </div>

              <div className="card" style={{ padding: "12px 18px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>환율 (1엔당 원)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={exchangeRateInput}
                  onChange={(e) => handleExchangeRateChange(e.target.value)}
                  style={{ width: 90, textAlign: "right", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", fontWeight: 700 }}
                />
              </div>

              <div className="card" style={{ padding: "6px 18px", marginBottom: 24 }}>
                {budgetByCategory.map(([category, amount], i) => (
                  <div
                    key={category}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      padding: "12px 0",
                      borderBottom: i < budgetByCategory.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <span style={{ color: "var(--text-muted)" }}>{category}</span>
                    <span>
                      <span style={{ fontWeight: 700 }}>{formatJPY(amount)}</span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 6 }}>≈ {formatKRW(amount * effectiveExchangeRate)}</span>
                    </span>
                  </div>
                ))}
              </div>

              <h4 style={{ marginBottom: 12, fontSize: 15 }}>장소별 예상 금액</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {itinerary.places.map((place) => (
                  <div key={place.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", gap: 12 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <MarqueeText text={place.name} style={{ fontWeight: 700 }} />
                        {place.aiRecommended && <AiBadge />}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{place.category}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ textAlign: "right" }}>
                        <input
                          value={getPlaceBudget(itinerary, place.id).toLocaleString("ko-KR")}
                          onChange={(e) => handleBudgetChange(place.id, e.target.value)}
                          style={{ width: 110, textAlign: "right", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontWeight: 600 }}
                        />
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                          ≈ {formatKRW(getPlaceBudget(itinerary, place.id) * effectiveExchangeRate)}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeletePlace(place.id)}
                        aria-label={`${place.name} 삭제`}
                        style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, padding: "4px 2px", color: "var(--text-muted)" }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <MapView pins={mapPins} height={520} focusId={focusedPlaceId} />
        </div>
      </div>

      {showAddModal && (
        <div
          onClick={() => setShowAddModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto", padding: 24 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>{selectedDay}일차에 장소 추가</h3>
              <button onClick={() => setShowAddModal(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "var(--text-muted)" }}>✕</button>
            </div>

            <label style={{ display: "block", fontWeight: 700, marginBottom: 8, fontSize: 13, color: "var(--text-muted)" }}>
              직접 검색해서 추가
            </label>
            <div style={{ display: "flex", gap: 8, marginBottom: excludedByCategory.length > 0 ? 20 : 0 }}>
              {hasMapsKey && isLoaded ? (
                <Autocomplete
                  onLoad={(ac) => (autocompleteRef.current = ac)}
                  onPlaceChanged={handleAddFromAutocomplete}
                  options={{
                    fields: ["name", "formatted_address", "geometry", "place_id", "types", "price_level"],
                    bounds: {
                      north: startPoint.lat + 0.35,
                      south: startPoint.lat - 0.35,
                      east: startPoint.lng + 0.35,
                      west: startPoint.lng - 0.35,
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
                    onKeyDown={(e) => e.key === "Enter" && handleAddManually()}
                    placeholder="장소 이름 입력"
                    style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 14 }}
                  />
                  <button onClick={handleAddManually} disabled={adding || !newPlaceName.trim()} className="btn btn-secondary" style={{ padding: "10px 18px" }}>
                    {adding ? "추가 중..." : "추가"}
                  </button>
                </>
              )}
            </div>

            {excludedByCategory.length > 0 && (
              <div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {excludedByCategory.map(([category]) => (
                    <button
                      key={category}
                      onClick={() => setExcludedCategoryFilter(excludedCategoryFilter === category ? null : category)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 999,
                        border: excludedCategoryFilter === category ? "none" : "1px solid var(--border)",
                        background: excludedCategoryFilter === category ? "linear-gradient(135deg, var(--primary), #5b7ff5)" : "#fff",
                        color: excludedCategoryFilter === category ? "#fff" : "var(--text)",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {category}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {excludedByCategory
                    .filter(([category]) => !excludedCategoryFilter || category === excludedCategoryFilter)
                    .flatMap(([, places]) => places)
                    .map((place) => (
                      <button
                        key={place.id}
                        onClick={() => handleAddFromExcluded(place)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          width: "100%",
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                          background: "#fff",
                          cursor: "pointer",
                          fontSize: 14,
                          textAlign: "left",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                          <MarqueeText text={place.name} style={{ fontWeight: 700 }} />
                          <span style={{ color: "var(--text-muted)", fontSize: 12, flexShrink: 0 }}>{place.category}</span>
                          {place.aiRecommended && <AiBadge />}
                        </span>
                        <span style={{ color: "var(--primary)", fontWeight: 700, fontSize: 13, flexShrink: 0, marginLeft: 8 }}>+ 추가</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showReanalyzeModal && (
        <div
          onClick={() => !reanalyzing && setShowReanalyzeModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: "100%", maxWidth: 480, padding: 24 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>✨ 요청사항으로 재분석</h3>
              {!reanalyzing && (
                <button onClick={() => setShowReanalyzeModal(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "var(--text-muted)" }}>✕</button>
              )}
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
              요청사항을 적으면 AI가 우선순위/페이스를 반영해 동선을 다시 짜고, 어울리는 장소도 추가로 추천해줘요.
            </p>
            <textarea
              value={reanalyzeNotesInput}
              onChange={(e) => setReanalyzeNotesInput(e.target.value)}
              placeholder="예: 아이랑 같이 가서 많이 안 걸었으면 좋겠어요. 카페 위주로 다니고 싶어요."
              disabled={reanalyzing}
              rows={4}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 14, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}
            />
            <button
              onClick={handleReanalyze}
              disabled={reanalyzing}
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 12, padding: "12px 16px", borderRadius: 12, fontWeight: 700 }}
            >
              {reanalyzing ? "재분석 중..." : "재분석 시작"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableVisitRow({
  id,
  index,
  place,
  placeCost,
  travelTimeMin,
  travelCost,
  mode,
  arrival,
  departure,
  stayMinutes,
  delay = 0,
  focused = false,
  onFocus,
  onDelete,
  onTravelCostChange,
  onPlaceCostChange,
  onStayMinutesChange,
}: {
  id: string;
  index: number;
  place: ParsedPlace;
  placeCost: number;
  travelTimeMin: number;
  travelCost: number;
  mode: string;
  arrival?: string;
  departure?: string;
  stayMinutes?: number;
  delay?: number;
  focused?: boolean;
  onFocus?: () => void;
  onDelete: () => void;
  onTravelCostChange: (value: string) => void;
  onPlaceCostChange: (value: string) => void;
  onStayMinutesChange?: (value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    animationDelay: `${delay}ms`,
  };

  return (
    <div
      ref={setNodeRef}
      className={`card pop-in visit-row${focused ? " focused" : ""}`}
      onClick={onFocus}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        cursor: onFocus ? "pointer" : undefined,
      }}
      {...attributes}
    >
      <div {...listeners} style={{ cursor: "grab", color: "#c2c7d2", fontSize: 18, padding: "0 4px" }}>⠿</div>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: CATEGORY_COLOR[place.category] ?? CATEGORY_COLOR["기타"],
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {index + 1}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <MarqueeText text={place.name} style={{ fontWeight: 700 }} />
          {place.aiRecommended && <AiBadge />}
          {arrival && departure && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--primary-dark)", background: "var(--primary-light)", padding: "1px 8px", borderRadius: 999, flexShrink: 0 }}>
              {arrival} - {departure}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)", marginTop: 2, flexWrap: "wrap" }}>
          <span>{TRANSPORT_LABEL[mode]} · {travelTimeMin}분 ·</span>
          <input
            value={travelCost.toLocaleString("ko-KR")}
            onChange={(e) => onTravelCostChange(e.target.value)}
            aria-label={`${place.name} 이동 비용`}
            style={{ width: 76, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }}
          />
          {onStayMinutesChange && stayMinutes !== undefined && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              · 체류
              <input
                type="number"
                min={0}
                step={5}
                value={stayMinutes}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onStayMinutesChange(e.target.value)}
                aria-label={`${place.name} 체류 시간(분)`}
                style={{ width: 48, padding: "3px 4px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12, textAlign: "right" }}
              />
              분
            </span>
          )}
        </div>
      </div>
      <input
        value={placeCost.toLocaleString("ko-KR")}
        onChange={(e) => onPlaceCostChange(e.target.value)}
        aria-label={`${place.name} 예상 비용`}
        style={{ width: 90, textAlign: "right", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontWeight: 700, fontSize: 12, color: "var(--primary-dark)" }}
      />
      <button
        onClick={onDelete}
        aria-label={`${place.name} 삭제`}
        style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, padding: "4px 2px", color: "var(--text-muted)" }}
      >
        ✕
      </button>
    </div>
  );
}

function AiBadge() {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#fff",
        background: "linear-gradient(135deg, #8e5bde, #5b7ff5)",
        padding: "2px 7px",
        borderRadius: 999,
        letterSpacing: 0.2,
        flexShrink: 0,
      }}
    >
      ✨ AI 추천
    </span>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 10,
  border: "none",
  background: "linear-gradient(135deg, var(--primary), #5b7ff5)",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 6px 14px rgba(59,109,240,0.28)",
};
const secondaryBtn: React.CSSProperties = { padding: "10px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "#fff", cursor: "pointer" };
const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "10px 24px",
  borderRadius: 10,
  border: active ? "none" : "1px solid var(--border)",
  background: active ? "linear-gradient(135deg, var(--primary), #5b7ff5)" : "#fff",
  color: active ? "#fff" : "var(--text)",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: active ? "0 6px 14px rgba(59,109,240,0.28)" : "none",
});
const dayBtn = (active: boolean): React.CSSProperties => ({
  padding: "8px 16px",
  borderRadius: 999,
  border: active ? "none" : "1px solid var(--border)",
  background: active ? "linear-gradient(135deg, var(--primary), #5b7ff5)" : "#fff",
  color: active ? "#fff" : "var(--text)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
});
