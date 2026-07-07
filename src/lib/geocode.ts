const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울 시청

export const hasMapsKey = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);

// @react-google-maps/api의 Loader는 앱 전체에서 동일한 id로는 동일한 options만 허용하므로
// 지도/자동완성을 쓰는 모든 곳에서 이 상수를 공유해야 한다.
export const MAPS_SCRIPT_ID = "google-maps-script";
export const MAPS_LIBRARIES: "places"[] = ["places"];

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

// 이름을 시드로 결정적인 좌표를 생성 (API 키가 없을 때 데모용 폴백)
function syntheticGeocode(name: string, center = DEFAULT_CENTER) {
  const h = hashString(name);
  const dLat = ((h % 1000) / 1000 - 0.5) * 0.12;
  const dLng = (((h >> 10) % 1000) / 1000 - 0.5) * 0.12;
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

let geocoderPromise: Promise<google.maps.Geocoder | null> | null = null;

async function loadGeocoder(): Promise<google.maps.Geocoder | null> {
  if (!hasMapsKey) return null;
  if (!geocoderPromise) {
    geocoderPromise = new Promise((resolve) => {
      const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
      const existing = document.getElementById("google-maps-script");
      const onReady = () => resolve(new google.maps.Geocoder());
      if ((window as any).google?.maps) {
        onReady();
        return;
      }
      if (existing) {
        existing.addEventListener("load", onReady);
        return;
      }
      const script = document.createElement("script");
      script.id = "google-maps-script";
      script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
      script.async = true;
      script.onload = onReady;
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }
  return geocoderPromise;
}

export async function geocodePlace(
  name: string,
  center = DEFAULT_CENTER
): Promise<{ lat: number; lng: number; address?: string }> {
  const geocoder = await loadGeocoder();
  if (!geocoder) return syntheticGeocode(name, center);

  // 선택한 여행지 주변으로 검색 결과를 편향시켜 동명이인/동명장소 오매칭을 줄인다
  const bias = 0.35;
  const bounds = {
    north: center.lat + bias,
    south: center.lat - bias,
    east: center.lng + bias,
    west: center.lng - bias,
  };

  return new Promise((resolve) => {
    geocoder.geocode({ address: name, bounds }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        const loc = results[0].geometry.location;
        resolve({ lat: loc.lat(), lng: loc.lng(), address: results[0].formatted_address });
      } else {
        resolve(syntheticGeocode(name, center));
      }
    });
  });
}

let placesServicePromise: Promise<google.maps.places.PlacesService | null> | null = null;

async function loadPlacesService(): Promise<google.maps.places.PlacesService | null> {
  if (!hasMapsKey) return null;
  const geocoder = await loadGeocoder();
  if (!geocoder) return null;
  if (!placesServicePromise) {
    placesServicePromise = new Promise((resolve) => {
      if (!(window as any).google?.maps?.places) {
        resolve(null);
        return;
      }
      resolve(new google.maps.places.PlacesService(document.createElement("div")));
    });
  }
  return placesServicePromise;
}

export interface PlaceDetails {
  placeId?: string;
  types?: string[];
}

// Google Places API(findPlaceFromQuery)로 실제 place_id, types 조회. 실패 시 null 반환 -> 호출측에서 폴백 처리
// center를 지정하면 해당 여행지 주변으로 검색을 편향시켜 동명이인/동명장소 오매칭을 줄인다
// price_level은 일부러 요청하지 않는다: "Atmosphere Data"로 분류되어 월 1,000회 이후 건당 과금되는데,
// 어차피 priceLevel은 estimatedCostJPY가 없을 때만 쓰는 폴백이라 seededPriceLevel 추정치로 충분하다.
export async function fetchPlaceDetails(name: string, center = DEFAULT_CENTER): Promise<PlaceDetails | null> {
  const service = await loadPlacesService();
  if (!service) return null;

  return new Promise((resolve) => {
    service.findPlaceFromQuery(
      { query: name, fields: ["place_id", "types"], locationBias: { center, radius: 40000 } },
      (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) {
          const r = results[0];
          resolve({ placeId: r.place_id, types: r.types });
        } else {
          resolve(null);
        }
      }
    );
  });
}

let distanceMatrixServicePromise: Promise<google.maps.DistanceMatrixService | null> | null = null;

async function loadDistanceMatrixService(): Promise<google.maps.DistanceMatrixService | null> {
  if (!hasMapsKey) return null;
  const geocoder = await loadGeocoder();
  if (!geocoder) return null;
  if (!distanceMatrixServicePromise) {
    distanceMatrixServicePromise = new Promise((resolve) => {
      if (!(window as any).google?.maps) {
        resolve(null);
        return;
      }
      resolve(new google.maps.DistanceMatrixService());
    });
  }
  return distanceMatrixServicePromise;
}

const TRAVEL_MODE_MAP: Record<"walk" | "transit" | "car", google.maps.TravelMode> = {
  walk: "WALKING" as google.maps.TravelMode,
  transit: "TRANSIT" as google.maps.TravelMode,
  car: "DRIVING" as google.maps.TravelMode,
};

export interface RealTravelInfo {
  travelTimeMin: number;
  distanceKm: number;
}

// 구글 지도 Distance Matrix API로 실제 이동시간/거리를 조회. 지도 API 키가 없거나 조회 실패 시 null 반환 -> 호출측에서 직선거리 추정치로 폴백
export async function fetchTravelTime(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: "walk" | "transit" | "car"
): Promise<RealTravelInfo | null> {
  const service = await loadDistanceMatrixService();
  if (!service) return null;

  return new Promise((resolve) => {
    service.getDistanceMatrix(
      {
        origins: [origin],
        destinations: [destination],
        travelMode: TRAVEL_MODE_MAP[mode],
      },
      (response, status) => {
        if (status !== "OK" || !response) {
          resolve(null);
          return;
        }
        const element = response.rows[0]?.elements[0];
        if (!element || element.status !== "OK") {
          resolve(null);
          return;
        }
        resolve({
          travelTimeMin: Math.max(1, Math.round(element.duration.value / 60)),
          distanceKm: element.distance.value / 1000,
        });
      }
    );
  });
}

export { DEFAULT_CENTER };
