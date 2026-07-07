import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LoadingScreen } from "../components/LoadingScreen";
import { useWizard } from "../lib/WizardContext";
import {
  buildItineraryDays,
  computeCentroid,
  haversineKm,
  computeDailyTransitBudget,
  refineVisitsWithRealTravelTimes,
  refineReturnLegWithRealTravelTime,
} from "../lib/generate";
import { interpretNotes, recommendAiPlaces } from "../lib/notesInterpreter";
import { getDestination } from "../lib/destinations";
import { geocodePlace, fetchPlaceDetails } from "../lib/geocode";
import { seededPriceLevel } from "../lib/parsePlaces";
import { saveItinerary } from "../lib/storage";
import type { Itinerary, ParsedPlace } from "../types";

// AI가 엉뚱한 지역(동명이인 지명 등)을 추천했을 때 걸러내기 위한 여행지 중심 반경(km)
const MAX_AI_PLACE_DISTANCE_KM = 60;

export default function GeneratingLoading() {
  const navigate = useNavigate();
  const { rawText, places, dayThemes, basecamp, basecampUndecided, days, notes, destination, allowCar, reset } = useWizard();

  useEffect(() => {
    if (places.length === 0 || dayThemes.length === 0) {
      navigate("/new/input");
      return;
    }

    let cancelled = false;

    (async () => {
      const interpretation = await interpretNotes(notes, places, days);
      if (cancelled) return;

      const placesWithNotes =
        interpretation && interpretation.mustVisitIds.length > 0
          ? places.map((p) => (interpretation.mustVisitIds.includes(p.id) ? { ...p, mustVisit: true } : p))
          : places;

      const destinationInfo = getDestination(destination);
      const locationContext = basecamp?.name || basecamp?.address;
      const aiRecommendations = await recommendAiPlaces(destinationInfo.label, placesWithNotes, notes, days, locationContext);
      if (cancelled) return;

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
          };
          return place;
        })
      );
      if (cancelled) return;

      const nearbyAiPlaces = aiPlaces.filter((p) => haversineKm(destinationInfo, p) <= MAX_AI_PLACE_DISTANCE_KM);
      const allPlaces = [...placesWithNotes, ...nearbyAiPlaces];

      const recommendedCenter = basecampUndecided ? computeCentroid(allPlaces) : null;
      const startPoint = basecamp ?? recommendedCenter ?? computeCentroid(allPlaces);
      const { itineraryDays: builtDays, excludedPlaces } = buildItineraryDays(
        allPlaces,
        dayThemes,
        startPoint,
        interpretation?.dayCapacity,
        allowCar
      );
      const excludedIds = new Set(excludedPlaces.map((p) => p.id));
      const includedPlaces = allPlaces.filter((p) => !excludedIds.has(p.id));

      const itineraryDays = await Promise.all(
        builtDays.map(async (day) => {
          const refinedVisits = await refineVisitsWithRealTravelTimes(day.visits, includedPlaces, startPoint);
          const lastPlace = refinedVisits.length > 0 ? includedPlaces.find((p) => p.id === refinedVisits[refinedVisits.length - 1].placeId) : undefined;
          const refinedReturnLeg = await refineReturnLegWithRealTravelTime(day.returnLeg, lastPlace, startPoint);
          return {
            ...day,
            visits: refinedVisits,
            returnLeg: refinedReturnLeg,
            dailyTransitBudget: computeDailyTransitBudget(refinedVisits, refinedReturnLeg),
          };
        })
      );
      if (cancelled) return;

      const itinerary: Itinerary = {
        id: crypto.randomUUID(),
        title: `${days}일 여행 일정`,
        rawInputText: rawText,
        notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        days,
        basecamp,
        basecampUndecided,
        recommendedCenter,
        places: includedPlaces,
        excludedPlaces,
        dayThemes,
        itineraryDays,
        budgetOverrides: [],
        destinationLabel: destinationInfo.label,
        allowCar,
      };

      saveItinerary(itinerary);
      reset();
      navigate(`/result/${itinerary.id}`);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <LoadingScreen
      message="테마에 맞춰 동선을 최적화하고 예산을 계산 중입니다..."
      subMessage="잠시만 기다려주세요"
      ticks={["일차별로 장소를 배분하고 있어요", "최적 동선을 계산하고 있어요", "이동 시간과 교통비를 산출하고 있어요", "예산을 정리하고 있어요"]}
    />
  );
}
