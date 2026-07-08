import type { Itinerary, ItinerarySummary, BudgetOverride } from "../types";
import { PRICE_LEVEL_JPY } from "./generate";

const ITINERARIES_KEY = "mapping.itineraries";
const SESSION_KEY = "mapping.session";

export interface Session {
  nickname: string;
  email: string;
}

// localStorage 값이 손상돼 있거나(수동 편집, 이전 스키마 등) 저장 공간이 꽉 찬 경우
// JSON.parse/setItem이 예외를 던지는데, 이걸 그대로 두면 앱 전체가 빈 화면으로 죽어버린다.
function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn("저장된 데이터를 읽지 못했어요. 기본값으로 대체합니다.");
    return fallback;
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn("저장 공간이 부족하거나 저장에 실패했어요.", err);
    return false;
  }
}

export function getSession(): Session | null {
  return safeParse(localStorage.getItem(SESSION_KEY), null);
}

export function login(session: Session) {
  safeSetItem(SESSION_KEY, JSON.stringify(session));
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

function readAll(): Itinerary[] {
  return safeParse(localStorage.getItem(ITINERARIES_KEY), []);
}

function writeAll(items: Itinerary[]): boolean {
  return safeSetItem(ITINERARIES_KEY, JSON.stringify(items));
}

export function saveItinerary(itinerary: Itinerary) {
  const all = readAll();
  const idx = all.findIndex((i) => i.id === itinerary.id);
  itinerary.updatedAt = new Date().toISOString();
  if (idx >= 0) all[idx] = itinerary;
  else all.unshift(itinerary);
  const ok = writeAll(all);
  if (!ok) alert("저장 공간이 부족해서 일정을 저장하지 못했어요. 불필요한 일정을 삭제한 뒤 다시 시도해주세요.");
}

export function getItinerary(id: string): Itinerary | null {
  return readAll().find((i) => i.id === id) ?? null;
}

export function deleteItinerary(id: string) {
  writeAll(readAll().filter((i) => i.id !== id));
}

export function duplicateItinerary(id: string): Itinerary | null {
  const original = getItinerary(id);
  if (!original) return null;
  const copy: Itinerary = {
    ...original,
    id: crypto.randomUUID(),
    title: `${original.title} (복제본)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    shareId: undefined,
  };
  saveItinerary(copy);
  return copy;
}

function defaultPlaceCost(place: { priceLevel: 1 | 2 | 3 | 4; estimatedCostJPY?: number }): number {
  return place.estimatedCostJPY ?? PRICE_LEVEL_JPY[place.priceLevel];
}

export function computeTotalBudget(itinerary: Itinerary): number {
  let total = 0;
  for (const place of itinerary.places) {
    const override = itinerary.budgetOverrides.find((o) => o.placeId === place.id);
    total += override ? override.amount : defaultPlaceCost(place);
  }
  for (const day of itinerary.itineraryDays) {
    total += day.dailyTransitBudget;
  }
  return total;
}

export function getPlaceBudget(itinerary: Itinerary, placeId: string): number {
  const override = itinerary.budgetOverrides.find((o) => o.placeId === placeId);
  if (override) return override.amount;
  const place = itinerary.places.find((p) => p.id === placeId);
  return place ? defaultPlaceCost(place) : 0;
}

export function setPlaceBudget(itinerary: Itinerary, placeId: string, amount: number): BudgetOverride[] {
  const overrides = itinerary.budgetOverrides.filter((o) => o.placeId !== placeId);
  overrides.push({ placeId, amount });
  return overrides;
}

export function importItineraryFromJSON(json: string): Itinerary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("올바른 JSON 파일이 아니에요.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as Itinerary).places) ||
    !Array.isArray((parsed as Itinerary).itineraryDays)
  ) {
    throw new Error("여행 일정 파일 형식이 아니에요.");
  }
  const now = new Date().toISOString();
  const imported: Itinerary = {
    ...(parsed as Itinerary),
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    shareId: undefined,
  };
  saveItinerary(imported);
  return imported;
}

export function listItinerarySummaries(): ItinerarySummary[] {
  return readAll().map((i) => ({
    id: i.id,
    title: i.title,
    days: i.days,
    totalBudget: computeTotalBudget(i),
    updatedAt: i.updatedAt,
    placeCount: i.places.length,
  }));
}
