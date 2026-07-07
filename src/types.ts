export type Category = "쇼핑" | "먹거리" | "관광" | "카페" | "숙소" | "기타";

export interface ParsedPlace {
  id: string;
  googlePlaceId?: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  priceLevel: 1 | 2 | 3 | 4;
  estimatedCostJPY?: number;
  category: Category;
  mustVisit: boolean;
  aiRecommended?: boolean;
}

export interface DayTheme {
  dayIndex: number;
  theme: Category | null;
}

export interface PlaceVisit {
  placeId: string;
  order: number;
  transportMode: "walk" | "transit" | "car";
  travelTimeMin: number;
  travelCost: number;
  stayMinutes?: number;
}

export interface ReturnLeg {
  transportMode: "walk" | "transit" | "car";
  travelTimeMin: number;
  travelCost: number;
}

export interface ItineraryDay {
  dayIndex: number;
  theme: Category | null;
  visits: PlaceVisit[];
  returnLeg: ReturnLeg | null;
  dailyTransitBudget: number;
  startTime?: string;
  endTimeTarget?: string;
}

export interface Basecamp {
  name: string;
  address?: string;
  lat: number;
  lng: number;
}

export interface BudgetOverride {
  placeId: string;
  amount: number;
}

export interface Itinerary {
  id: string;
  title: string;
  rawInputText: string;
  notes: string;
  excludedPlaces: ParsedPlace[];
  createdAt: string;
  updatedAt: string;
  days: number;
  basecamp: Basecamp | null;
  basecampUndecided: boolean;
  recommendedCenter: { lat: number; lng: number } | null;
  places: ParsedPlace[];
  dayThemes: DayTheme[];
  itineraryDays: ItineraryDay[];
  budgetOverrides: BudgetOverride[];
  shareId?: string;
  exchangeRate?: number;
  destinationLabel?: string;
  allowCar?: boolean;
}

export interface ItinerarySummary {
  id: string;
  title: string;
  days: number;
  totalBudget: number;
  updatedAt: string;
  placeCount: number;
}
