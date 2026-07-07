import type { Category, ParsedPlace } from "../types";
import { geocodePlace, fetchPlaceDetails } from "./geocode";
import { callGemini } from "./gemini";

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  쇼핑: ["백화점", "몰", "아울렛", "마켓", "시장", "스토어", "샵", "면세점"],
  먹거리: ["식당", "맛집", "레스토랑", "고기", "국밥", "맛", "분식", "치킨", "포차", "이자카야", "스시", "라멘"],
  카페: ["카페", "커피", "베이커리", "디저트", "빵집", "브런치"],
  관광: ["공원", "박물관", "전망대", "궁", "사원", "타워", "미술관", "해변", "산", "명소", "유적"],
  숙소: ["호텔", "게스트하우스", "펜션", "리조트", "모텔", "호스텔"],
  기타: [],
};

// Google Places API의 type을 우리 카테고리 체계로 매핑
const GOOGLE_TYPE_TO_CATEGORY: Record<string, Category> = {
  shopping_mall: "쇼핑",
  department_store: "쇼핑",
  clothing_store: "쇼핑",
  market: "쇼핑",
  restaurant: "먹거리",
  meal_takeaway: "먹거리",
  meal_delivery: "먹거리",
  food: "먹거리",
  cafe: "카페",
  bakery: "카페",
  tourist_attraction: "관광",
  park: "관광",
  museum: "관광",
  art_gallery: "관광",
  amusement_park: "관광",
  zoo: "관광",
  lodging: "숙소",
};

export function guessCategory(name: string): Category {
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [Category, string[]][]) {
    if (keywords.some((k) => name.includes(k))) return category;
  }
  return "기타";
}

export function categoryFromGoogleTypes(types?: string[]): Category | null {
  if (!types) return null;
  for (const type of types) {
    const category = GOOGLE_TYPE_TO_CATEGORY[type];
    if (category) return category;
  }
  return null;
}

export function seededPriceLevel(name: string): 1 | 2 | 3 | 4 {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % 97;
  return ((h % 4) + 1) as 1 | 2 | 3 | 4;
}

// 2026년 기준 대략적인 원화->엔화 환산 비율 (실시간 환율 API 없이 근사치로 사용)
const KRW_TO_JPY = 1 / 9.3;

// 텍스트에 이미 적힌 가격대("¥1,000~2,000", "₩10,000")를 찾아 1인 기준 엔화로 환산
function extractPriceRangeJPY(block: string): number | null {
  const match = block.match(/([¥₩])\s?([\d,]+)(?:\s?[~\-]\s?[¥₩]?\s?([\d,]+))?/);
  if (!match) return null;
  const currency = match[1];
  const min = Number(match[2].replace(/,/g, ""));
  const max = match[3] ? Number(match[3].replace(/,/g, "")) : min;
  if (!min) return null;
  const avg = (min + max) / 2;
  return Math.round(currency === "₩" ? avg * KRW_TO_JPY : avg);
}

// 원본 텍스트에서 해당 장소명이 포함된 블록을 찾아 가격 힌트를 추출 (LLM/규칙 기반 파싱 방식과 무관하게 동작)
function findPriceHintForName(text: string, name: string): number | null {
  const blocks = text.split(/\r?\n\s*\r?\n+/);
  const block = blocks.find((b) => b.includes(name));
  if (!block) return null;
  return extractPriceRangeJPY(block);
}

// 별점("4.2(424)"), 가격대("¥1,000~2,000"), 카테고리("· 일식"), 주소("〒812-..." / 우편번호)처럼
// 장소명이 아닌 메타데이터 줄인지 판별
function isMetadataLine(line: string): boolean {
  if (/^[\d.,()\s★☆]+$/.test(line)) return true; // 별점/리뷰수만 있는 줄
  if (/^[¥₩$]/.test(line)) return true; // 가격대
  if (/^[·|•]/.test(line)) return true; // "· 카테고리"
  if (/^〒/.test(line)) return true; // 우편번호로 시작하는 주소 블록
  return false;
}

function cleanName(line: string): string {
  // "1. 장소명" 같은 번호 매김 제거, "장소명 · 4.5 · 카페" 형태는 구분자 앞부분만 사용
  return line.replace(/^\d+[.).\s]+/, "").split(/[·|•]/)[0].trim();
}

// 구글 지도에서 복사한 텍스트에서 장소명 후보를 추출하는 규칙 기반 파서.
// 구글 지도 저장 목록은 보통 장소마다 "장소명 / 평점(리뷰수) / 가격대 / · 카테고리 / (선택)메모" 순으로
// 여러 줄에 걸쳐 있고, 장소 사이는 빈 줄로 구분된다. 이 구조를 우선 활용하고,
// 빈 줄 구분이 없는 단순 한 줄당 한 장소 형태(예: "1. 스타벅스 강남점")도 함께 지원한다.
function extractNamesRuleBased(text: string): string[] {
  const blocks = text.split(/\r?\n\s*\r?\n+/).filter((b) => b.trim());
  const names: string[] = [];

  const isBlockFormat = blocks.length > 1;

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    if (isBlockFormat) {
      // 블록의 첫 줄이 메타데이터가 아니면 그 줄이 장소명 (블록당 장소 하나)
      if (isMetadataLine(lines[0])) continue;
      const cleaned = cleanName(lines[0]);
      if (cleaned && cleaned.length >= 2) names.push(cleaned);
    } else {
      // 빈 줄 구분이 없는 경우: 각 줄을 독립된 장소 후보로 처리
      for (const line of lines) {
        if (isMetadataLine(line)) continue;
        const cleaned = cleanName(line);
        if (cleaned && cleaned.length >= 2) names.push(cleaned);
      }
    }
  }

  return Array.from(new Set(names));
}

interface LlmPlace {
  name: string;
  estimatedCostJPY?: number;
}

// LLM에게 장소 추출 + (가격 정보가 텍스트에 없는 경우) 웹 검색으로 실제 예상 비용까지 함께 요청.
// 검색 그라운딩을 지원하지 않는 환경이면 그냥 무시되고 텍스트 추출만 동작한다.
async function llmExtractPlaces(text: string): Promise<LlmPlace[] | null> {
  const response = await callGemini(
    `다음은 구글 지도에서 복사한 저장 장소 목록 텍스트입니다. 장소마다 보통 "장소명 / 평점(리뷰수) / 가격대(¥ 또는 ₩ 표시) / · 카테고리 / (선택) 메모나 주소" 순서로 여러 줄에 걸쳐 있고, 장소 사이는 빈 줄로 구분되어 있습니다.

여기서 실제 장소명만 추출해줘. 평점/리뷰수, 가격대, 카테고리, 메모, 주소는 장소명이 아니니 제외해.

각 장소마다 1인 기준 예상 비용을 엔화(JPY)로 추정해서 함께 넣어줘:
- 텍스트에 이미 가격대(¥ 또는 ₩)가 적혀있으면 그 값을 엔화로 환산해서 사용
- 가격 정보가 없으면 검색해서 해당 장소(또는 비슷한 업종)의 실제 가격대를 찾아 추정
- 그래도 찾을 수 없으면 업종 평균으로 합리적으로 추정 (숙소/관광지는 입장료나 1박 기준, 식당/카페는 1인 식사 기준)

마지막 응답은 다른 설명 없이 아래 형식의 JSON 배열만 출력해:
[{"name": "장소명", "estimatedCostJPY": 1500}, ...]

${text}`,
    true
  );
  if (!response) return null;
  try {
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((x) => x && typeof x.name === "string")
      .map((x) => ({
        name: x.name,
        estimatedCostJPY: typeof x.estimatedCostJPY === "number" ? Math.round(x.estimatedCostJPY) : undefined,
      }));
  } catch {
    return null;
  }
}

export async function parsePlacesFromText(
  text: string,
  center: { lat: number; lng: number }
): Promise<ParsedPlace[]> {
  const llmPlaces = await llmExtractPlaces(text);
  const entries: LlmPlace[] =
    llmPlaces && llmPlaces.length > 0 ? llmPlaces : extractNamesRuleBased(text).map((name) => ({ name }));

  const places = await Promise.all(
    entries.map(async ({ name, estimatedCostJPY }) => {
      const [geo, details] = await Promise.all([geocodePlace(name, center), fetchPlaceDetails(name, center)]);
      const place: ParsedPlace = {
        id: crypto.randomUUID(),
        googlePlaceId: details?.placeId,
        name,
        address: geo.address,
        lat: geo.lat,
        lng: geo.lng,
        priceLevel: seededPriceLevel(name),
        estimatedCostJPY: estimatedCostJPY ?? findPriceHintForName(text, name) ?? undefined,
        category: categoryFromGoogleTypes(details?.types) ?? guessCategory(name),
        mustVisit: false,
      };
      return place;
    })
  );

  return places;
}
