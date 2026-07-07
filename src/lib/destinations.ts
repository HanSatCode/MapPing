export interface Destination {
  id: "fukuoka" | "osaka" | "other";
  label: string;
  emoji: string;
  lat: number;
  lng: number;
}

export const DESTINATIONS: Destination[] = [
  { id: "fukuoka", label: "후쿠오카", emoji: "⛩️", lat: 33.5904, lng: 130.4017 },
  { id: "osaka", label: "오사카", emoji: "🏯", lat: 34.6937, lng: 135.5023 },
  { id: "other", label: "그 외 지역", emoji: "🌍", lat: 20, lng: 0 },
];

export type DestinationId = Destination["id"];

export function getDestination(id: DestinationId): Destination {
  return DESTINATIONS.find((d) => d.id === id) ?? DESTINATIONS[0];
}
