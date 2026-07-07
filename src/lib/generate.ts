import type { Basecamp, Category, DayTheme, ItineraryDay, ParsedPlace, PlaceVisit, ReturnLeg } from "../types";
import { fetchTravelTime } from "./geocode";

// 가격대별 1인 기준 예상 비용(엔화, JPY)
export const PRICE_LEVEL_JPY: Record<1 | 2 | 3 | 4, number> = {
  1: 1000,
  2: 3000,
  3: 6000,
  4: 12000,
};

const WALK_SPEED_KMH = 4.5;
// 실제 대중교통은 순수 주행 속도가 아니라 역까지 도보 접근 + 대기 + 환승이 끼어들어 체감 속도가 훨씬 느리다.
// 짧은 구간일수록 이 고정 오버헤드 비중이 커지므로, 속도만으로 추정하면 크게 과소평가된다.
const TRANSIT_SPEED_KMH = 15;
const TRANSIT_OVERHEAD_MIN = 15;
const CAR_SPEED_KMH = 28;
const CAR_OVERHEAD_MIN = 5;

// 일본 지하철/버스는 거리 비례가 아니라 기본요금 + 구간 초과 요금 구조 (후쿠오카 260엔/오사카 200엔 기본요금 기준)
const TRANSIT_BASE_FARE_JPY = 230;
const TRANSIT_BASE_KM = 2;
const TRANSIT_PER_KM_JPY = 32;

// 택시도 기본요금(약 1.5km) + 초과 거리 요금 구조 (후쿠오카 기준 첫 1.5km 750엔)
const CAR_BASE_FARE_JPY = 750;
const CAR_BASE_KM = 1.5;
const CAR_PER_KM_JPY = 400;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.asin(Math.sqrt(h));
}

export function computeCentroid(places: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (places.length === 0) return { lat: 37.5665, lng: 126.978 };
  const sum = places.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: sum.lat / places.length, lng: sum.lng / places.length };
}

// 테마별로 장소를 일차에 분배: 카테고리가 일치하는 곳 우선, 남는 곳은 라운드로빈
export function distributePlacesByTheme(places: ParsedPlace[], dayThemes: DayTheme[]): Map<number, ParsedPlace[]> {
  const result = new Map<number, ParsedPlace[]>();
  dayThemes.forEach((dt) => result.set(dt.dayIndex, []));

  const unassigned: ParsedPlace[] = [];
  for (const place of places) {
    const matchingDay = dayThemes.find((dt) => dt.theme === place.category);
    if (matchingDay) {
      result.get(matchingDay.dayIndex)!.push(place);
    } else {
      unassigned.push(place);
    }
  }

  let i = 0;
  for (const place of unassigned) {
    const day = dayThemes[i % dayThemes.length];
    result.get(day.dayIndex)!.push(place);
    i++;
  }

  return result;
}

// 하루에 실제로 소화 가능한 장소 수 (경험적 기본값). '꼭 가고 싶어요'로 표시한 곳은 초과해도 유지한다.
const DEFAULT_DAY_CAPACITY = 4;

export function capDayPlaces(
  places: ParsedPlace[],
  capacity: number = DEFAULT_DAY_CAPACITY
): { kept: ParsedPlace[]; overflow: ParsedPlace[] } {
  if (places.length <= capacity) return { kept: places, overflow: [] };
  const mustVisit = places.filter((p) => p.mustVisit);
  const rest = places.filter((p) => !p.mustVisit);
  const remainingSlots = Math.max(0, capacity - mustVisit.length);
  return { kept: [...mustVisit, ...rest.slice(0, remainingSlots)], overflow: rest.slice(remainingSlots) };
}

function transportModeFor(km: number, allowCar: boolean): "walk" | "transit" | "car" {
  if (km < 1) return "walk";
  if (km < 8 || !allowCar) return "transit";
  return "car";
}

export function computeLeg(from: { lat: number; lng: number }, to: { lat: number; lng: number }, allowCar: boolean = true) {
  const km = haversineKm(from, to);
  const mode = transportModeFor(km, allowCar);

  let travelCost = 0;
  let travelTimeMin: number;
  if (mode === "walk") {
    travelTimeMin = (km / WALK_SPEED_KMH) * 60;
  } else if (mode === "transit") {
    travelCost = TRANSIT_BASE_FARE_JPY + Math.max(0, km - TRANSIT_BASE_KM) * TRANSIT_PER_KM_JPY;
    travelTimeMin = TRANSIT_OVERHEAD_MIN + (km / TRANSIT_SPEED_KMH) * 60;
  } else {
    travelCost = CAR_BASE_FARE_JPY + Math.max(0, km - CAR_BASE_KM) * CAR_PER_KM_JPY;
    travelTimeMin = CAR_OVERHEAD_MIN + (km / CAR_SPEED_KMH) * 60;
  }

  return {
    transportMode: mode,
    travelTimeMin: Math.max(1, Math.round(travelTimeMin)),
    travelCost: Math.round(travelCost),
  };
}

// Basecamp에서 출발해 가장 가까운 곳부터 방문하는 그리디(최근접 이웃) 동선 계산
export function buildDayRoute(
  places: ParsedPlace[],
  start: { lat: number; lng: number },
  allowCar: boolean = true
): PlaceVisit[] {
  const remaining = [...places];
  const visits: PlaceVisit[] = [];
  let current = start;
  let order = 0;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    remaining.forEach((p, idx) => {
      const d = haversineKm(current, p);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = idx;
      }
    });
    const next = remaining.splice(nearestIdx, 1)[0];
    const leg = computeLeg(current, next, allowCar);

    visits.push({
      placeId: next.id,
      order: order++,
      transportMode: leg.transportMode,
      travelTimeMin: leg.travelTimeMin,
      travelCost: leg.travelCost,
    });
    current = next;
  }

  return visits;
}

// 그 날의 마지막 방문지에서 숙소(또는 중심점)로 복귀하는 구간 계산
export function computeReturnLeg(
  visits: PlaceVisit[],
  places: ParsedPlace[],
  start: { lat: number; lng: number },
  allowCar: boolean = true
): ReturnLeg | null {
  if (visits.length === 0) return null;
  const lastVisit = visits[visits.length - 1];
  const lastPlace = places.find((p) => p.id === lastVisit.placeId);
  if (!lastPlace) return null;
  return computeLeg(lastPlace, start, allowCar);
}

// 사용자가 드래그로 순서를 바꿨을 때, 고정된 순서를 그대로 두고 이동시간/비용만 재계산
export function recomputeVisitsForOrder(
  orderedPlaceIds: string[],
  places: ParsedPlace[],
  start: { lat: number; lng: number },
  allowCar: boolean = true
): PlaceVisit[] {
  let current = start;
  return orderedPlaceIds.map((placeId, idx) => {
    const place = places.find((p) => p.id === placeId)!;
    const leg = computeLeg(current, place, allowCar);
    current = place;
    return { placeId, order: idx, ...leg };
  });
}

// 직선거리 추정치로 계산된 구간을 구글 지도 Distance Matrix API의 실제 이동시간/거리로 보정.
// TRANSIT은 지역/키에 따라 ZERO_RESULTS로 실패하는 경우가 있는데, 이때 그냥 직선거리 추정치로 두면
// 실제 도로/우회 거리를 반영하지 못해 크게 과소평가된다. 이 경우 DRIVING 실거리라도 가져와
// 대중교통 공식(기본 대기/환승 시간 + 속도)에 대입해 더 현실적인 값을 만든다.
async function refineLeg<T extends { transportMode: "walk" | "transit" | "car"; travelTimeMin: number; travelCost: number }>(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  leg: T
): Promise<T> {
  const real = await fetchTravelTime(from, to, leg.transportMode);
  if (real) {
    const km = real.distanceKm;
    let travelCost = leg.travelCost;
    if (leg.transportMode === "transit") {
      travelCost = Math.round(TRANSIT_BASE_FARE_JPY + Math.max(0, km - TRANSIT_BASE_KM) * TRANSIT_PER_KM_JPY);
    } else if (leg.transportMode === "car") {
      travelCost = Math.round(CAR_BASE_FARE_JPY + Math.max(0, km - CAR_BASE_KM) * CAR_PER_KM_JPY);
    }
    return { ...leg, travelTimeMin: real.travelTimeMin, travelCost };
  }

  if (leg.transportMode === "transit") {
    const drivingReal = await fetchTravelTime(from, to, "car");
    if (drivingReal) {
      const km = drivingReal.distanceKm;
      const travelCost = Math.round(TRANSIT_BASE_FARE_JPY + Math.max(0, km - TRANSIT_BASE_KM) * TRANSIT_PER_KM_JPY);
      const travelTimeMin = Math.max(1, Math.round(TRANSIT_OVERHEAD_MIN + (km / TRANSIT_SPEED_KMH) * 60));
      return { ...leg, travelTimeMin, travelCost };
    }
  }

  return leg;
}

// 방문 순서를 그대로 두고, 각 구간의 이동시간/비용을 실제 API 값으로 순차 보정
export async function refineVisitsWithRealTravelTimes(
  visits: PlaceVisit[],
  places: ParsedPlace[],
  start: { lat: number; lng: number }
): Promise<PlaceVisit[]> {
  let current = start;
  const refined: PlaceVisit[] = [];
  for (const visit of visits) {
    const place = places.find((p) => p.id === visit.placeId);
    if (!place) {
      refined.push(visit);
      continue;
    }
    const leg = await refineLeg(current, place, visit);
    refined.push({ ...visit, transportMode: leg.transportMode, travelTimeMin: leg.travelTimeMin, travelCost: leg.travelCost });
    current = place;
  }
  return refined;
}

// 복귀 구간의 이동시간/비용을 실제 API 값으로 보정
export async function refineReturnLegWithRealTravelTime(
  returnLeg: ReturnLeg | null,
  lastPlace: { lat: number; lng: number } | undefined,
  start: { lat: number; lng: number }
): Promise<ReturnLeg | null> {
  if (!returnLeg || !lastPlace) return returnLeg;
  return refineLeg(lastPlace, start, returnLeg);
}

// 그 날의 이동(숙소->A->B->숙소) 구간 비용 합계
export function computeDailyTransitBudget(visits: PlaceVisit[], returnLeg: ReturnLeg | null): number {
  const visitsCost = visits.reduce((sum, v) => sum + v.travelCost, 0);
  return visitsCost + (returnLeg?.travelCost ?? 0);
}

export function buildItineraryDays(
  places: ParsedPlace[],
  dayThemes: DayTheme[],
  basecamp: Basecamp | { lat: number; lng: number },
  dayCapacity: number = DEFAULT_DAY_CAPACITY,
  allowCar: boolean = true
): { itineraryDays: ItineraryDay[]; excludedPlaces: ParsedPlace[] } {
  const distribution = distributePlacesByTheme(places, dayThemes);
  const excludedPlaces: ParsedPlace[] = [];

  const itineraryDays = dayThemes.map((dt) => {
    const dayPlaces = distribution.get(dt.dayIndex) ?? [];
    const { kept, overflow } = capDayPlaces(dayPlaces, dayCapacity);
    excludedPlaces.push(...overflow);

    const orderedByRoute = buildDayRoute(kept, basecamp, allowCar);
    const returnLeg = computeReturnLeg(orderedByRoute, kept, basecamp, allowCar);
    const dailyTransitBudget = computeDailyTransitBudget(orderedByRoute, returnLeg);
    return {
      dayIndex: dt.dayIndex,
      theme: dt.theme,
      visits: orderedByRoute,
      returnLeg,
      dailyTransitBudget,
      startTime: DEFAULT_DAY_START_TIME,
      endTimeTarget: DEFAULT_DAY_END_TIME_TARGET,
    };
  });

  return { itineraryDays, excludedPlaces };
}

export function findPlaceById(places: ParsedPlace[], id: string): ParsedPlace | undefined {
  return places.find((p) => p.id === id);
}

export const CATEGORY_LIST: Category[] = ["쇼핑", "먹거리", "관광", "카페", "기타"];

export const DEFAULT_DAY_START_TIME = "09:00";
export const DEFAULT_DAY_END_TIME_TARGET = "21:00";

// 카테고리별 평균 체류 시간(분) 추정치
export const STAY_MINUTES: Record<Category, number> = {
  쇼핑: 60,
  먹거리: 70,
  관광: 90,
  카페: 45,
  숙소: 0,
  기타: 60,
};

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(totalMinutes: number): string {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface DayTimelineStop {
  placeId: string;
  arrival: string;
  departure: string;
}

// 시작 시간부터 이동시간 + 카테고리별 체류시간을 누적해 각 방문지의 도착/출발 시각과 하루 종료 예상 시각을 계산
export function computeDayTimeline(
  visits: PlaceVisit[],
  places: ParsedPlace[],
  returnLeg: ReturnLeg | null,
  startTime: string = DEFAULT_DAY_START_TIME
): { stops: DayTimelineStop[]; endTime: string } {
  let cursor = timeToMinutes(startTime);
  const stops = visits.map((visit) => {
    cursor += visit.travelTimeMin;
    const arrival = cursor;
    const place = places.find((p) => p.id === visit.placeId);
    cursor += visit.stayMinutes ?? (place ? STAY_MINUTES[place.category] : 60);
    return { placeId: visit.placeId, arrival: minutesToTime(arrival), departure: minutesToTime(cursor) };
  });
  if (returnLeg) cursor += returnLeg.travelTimeMin;
  return { stops, endTime: minutesToTime(cursor) };
}
