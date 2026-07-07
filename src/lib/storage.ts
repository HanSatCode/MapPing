import type { Itinerary, ItinerarySummary, BudgetOverride } from "../types";
import { PRICE_LEVEL_JPY } from "./generate";

const ITINERARIES_KEY = "mapping.itineraries";
const SESSION_KEY = "mapping.session";

export interface Session {
  nickname: string;
  email: string;
}

export function getSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function login(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

function readAll(): Itinerary[] {
  const raw = localStorage.getItem(ITINERARIES_KEY);
  return raw ? JSON.parse(raw) : [];
}

function writeAll(items: Itinerary[]) {
  localStorage.setItem(ITINERARIES_KEY, JSON.stringify(items));
}

export function saveItinerary(itinerary: Itinerary) {
  const all = readAll();
  const idx = all.findIndex((i) => i.id === itinerary.id);
  itinerary.updatedAt = new Date().toISOString();
  if (idx >= 0) all[idx] = itinerary;
  else all.unshift(itinerary);
  writeAll(all);
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
