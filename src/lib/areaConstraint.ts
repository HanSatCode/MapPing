import type { ItineraryDay, ParsedPlace } from "../types";
import type { DayAreaConstraint, DayPlaceRequest } from "./notesInterpreter";
import { recommendAiPlaces } from "./notesInterpreter";
import { geocodePlace, fetchPlaceDetails } from "./geocode";
import { seededPriceLevel } from "./parsePlaces";
import {
  haversineKm,
  maxWalkMinutesToKm,
  buildDayRoute,
  computeReturnLeg,
  computeDailyTransitBudget,
  refineVisitsWithRealTravelTimes,
  refineReturnLegWithRealTravelTime,
  DEFAULT_DAY_CAPACITY,
} from "./generate";

// "N일차에는 OO 주변 M분 도보로만" 같은 요청사항을 실제 일정에 반영한다.
// 해당 날짜의 방문지를 기준 장소(landmark) 반경 안으로 제한하고, 부족하면 그 반경 안에서 AI 추천으로 채운다.
export async function applyDayAreaConstraints(
  constraints: DayAreaConstraint[],
  itineraryDays: ItineraryDay[],
  allPlaces: ParsedPlace[],
  destinationCenter: { lat: number; lng: number },
  basecamp: { lat: number; lng: number },
  allowCar: boolean,
  notes: string,
  destinationLabel: string
): Promise<{ itineraryDays: ItineraryDay[]; allPlaces: ParsedPlace[] }> {
  let days = [...itineraryDays];
  let places = [...allPlaces];

  for (const constraint of constraints) {
    const dayIdx = days.findIndex((d) => d.dayIndex === constraint.dayIndex);
    if (dayIdx === -1) continue;
    const day = days[dayIdx];

    const landmarkGeo = await geocodePlace(constraint.landmark, destinationCenter);
    const maxWalkKm = maxWalkMinutesToKm(constraint.maxWalkMinutes);

    const placesById = new Map(places.map((p) => [p.id, p]));
    const usedElsewhere = new Set(
      days.filter((d) => d.dayIndex !== constraint.dayIndex).flatMap((d) => d.visits.map((v) => v.placeId))
    );

    // 이 날짜에 이미 배정됐던 '꼭 가고 싶어요' 장소는 반경 밖이라도 그대로 유지한다.
    const mustKeep = day.visits
      .map((v) => placesById.get(v.placeId))
      .filter((p): p is ParsedPlace => !!p && p.mustVisit);
    const mustKeepIds = new Set(mustKeep.map((p) => p.id));

    const withinRadius = places.filter(
      (p) => !usedElsewhere.has(p.id) && !mustKeepIds.has(p.id) && haversineKm(p, landmarkGeo) <= maxWalkKm
    );
    withinRadius.sort((a, b) => haversineKm(a, landmarkGeo) - haversineKm(b, landmarkGeo));

    const targetCount = Math.max(day.visits.length, 2, Math.min(DEFAULT_DAY_CAPACITY, 4));
    let candidates = [...mustKeep, ...withinRadius];

    if (candidates.length < targetCount) {
      const needed = targetCount - candidates.length;
      const existingForPrompt = places; // 이미 있는 장소와 중복 추천 방지
      const recommendations = await recommendAiPlaces(
        destinationLabel,
        existingForPrompt,
        notes,
        1,
        constraint.landmark,
        { countOverride: needed + 2, strictProximity: true }
      );

      const newAiPlaces: ParsedPlace[] = await Promise.all(
        recommendations.map(async (rec) => {
          const [geo, details] = await Promise.all([
            geocodePlace(rec.name, destinationCenter),
            fetchPlaceDetails(rec.name, destinationCenter),
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

      const newNearby = newAiPlaces.filter((p) => haversineKm(p, landmarkGeo) <= maxWalkKm);
      places = [...places, ...newNearby];
      candidates = [...candidates, ...newNearby];
    }

    const finalDayPlaces = candidates.slice(0, Math.max(targetCount, mustKeep.length));

    const heuristicVisits = buildDayRoute(finalDayPlaces, basecamp, allowCar, maxWalkKm);
    const refinedVisits = await refineVisitsWithRealTravelTimes(heuristicVisits, finalDayPlaces, basecamp);
    const lastPlace =
      refinedVisits.length > 0 ? finalDayPlaces.find((p) => p.id === refinedVisits[refinedVisits.length - 1].placeId) : undefined;
    const heuristicReturnLeg = computeReturnLeg(refinedVisits, finalDayPlaces, basecamp, allowCar, maxWalkKm);
    const refinedReturnLeg = await refineReturnLegWithRealTravelTime(heuristicReturnLeg, lastPlace, basecamp);

    days[dayIdx] = {
      ...day,
      visits: refinedVisits,
      returnLeg: refinedReturnLeg,
      dailyTransitBudget: computeDailyTransitBudget(refinedVisits, refinedReturnLeg),
      curation: undefined,
    };
  }

  // 최종적으로 어느 날에도 배정되지 않은 장소는 제외 목록으로 자연스럽게 빠진다 (호출측에서 처리).
  return { itineraryDays: days, allPlaces: places };
}

// "N일차에 OO 찾아서 넣어줘" 같은 요청사항을 반영한다. 그 날짜의 기존 방문지는 그대로 두고,
// 실제로 찾은 장소 하나를 추가해서 그 날짜만 동선을 다시 계산한다 (다른 날짜는 건드리지 않음).
export async function applyDayPlaceRequests(
  requests: DayPlaceRequest[],
  itineraryDays: ItineraryDay[],
  allPlaces: ParsedPlace[],
  destinationCenter: { lat: number; lng: number },
  basecamp: { lat: number; lng: number },
  allowCar: boolean
): Promise<{ itineraryDays: ItineraryDay[]; allPlaces: ParsedPlace[] }> {
  let days = [...itineraryDays];
  let places = [...allPlaces];

  for (const request of requests) {
    const dayIdx = days.findIndex((d) => d.dayIndex === request.dayIndex);
    if (dayIdx === -1) continue;
    const day = days[dayIdx];

    // 이미 이 이름의 장소가 어딘가에 있으면 새로 만들지 않고 재사용한다.
    const existing = places.find((p) => p.name === request.placeName);
    let newPlace: ParsedPlace;
    if (existing) {
      newPlace = { ...existing, mustVisit: true };
      places = places.map((p) => (p.id === existing.id ? newPlace : p));
    } else {
      const [geo, details] = await Promise.all([
        geocodePlace(request.placeName, destinationCenter),
        fetchPlaceDetails(request.placeName, destinationCenter),
      ]);
      newPlace = {
        id: crypto.randomUUID(),
        googlePlaceId: details?.placeId,
        name: request.placeName,
        address: geo.address,
        lat: geo.lat,
        lng: geo.lng,
        priceLevel: seededPriceLevel(request.placeName),
        category: "기타",
        mustVisit: true,
      };
      places = [...places, newPlace];
    }

    const placesById = new Map(places.map((p) => [p.id, p]));
    const currentDayPlaces = day.visits.map((v) => placesById.get(v.placeId)).filter((p): p is ParsedPlace => !!p);
    const finalDayPlaces = currentDayPlaces.some((p) => p.id === newPlace.id)
      ? currentDayPlaces
      : [...currentDayPlaces, newPlace];

    const heuristicVisits = buildDayRoute(finalDayPlaces, basecamp, allowCar);
    const refinedVisits = await refineVisitsWithRealTravelTimes(heuristicVisits, finalDayPlaces, basecamp);
    const lastPlace =
      refinedVisits.length > 0 ? finalDayPlaces.find((p) => p.id === refinedVisits[refinedVisits.length - 1].placeId) : undefined;
    const heuristicReturnLeg = computeReturnLeg(refinedVisits, finalDayPlaces, basecamp, allowCar);
    const refinedReturnLeg = await refineReturnLegWithRealTravelTime(heuristicReturnLeg, lastPlace, basecamp);

    days[dayIdx] = {
      ...day,
      visits: refinedVisits,
      returnLeg: refinedReturnLeg,
      dailyTransitBudget: computeDailyTransitBudget(refinedVisits, refinedReturnLeg),
      curation: undefined,
    };
  }

  return { itineraryDays: days, allPlaces: places };
}
