import type { Category, ParsedPlace } from "../types";
import { callGemini } from "./gemini";

const CATEGORIES: Category[] = ["쇼핑", "먹거리", "관광", "카페", "숙소", "기타"];

export interface NotesInterpretation {
  mustVisitIds: string[];
  dayCapacity?: number;
}

// 사용자가 적은 자유 텍스트 "요청사항"(예: "아이랑 가서 많이 안 걸었으면 좋겠어", "스타벅스는 꼭 가고 싶어")을
// LLM으로 해석해서, 실제 일정 생성(buildItineraryDays)에 반영할 수 있는 형태로 변환한다.
// - mustVisitIds: 요청사항에서 우선순위가 높다고 판단되는 장소 id (하루 정원 초과 시에도 제외되지 않음)
// - dayCapacity: 요청사항이 하루 방문 개수(페이스)에 대한 선호를 담고 있으면 그 값을 제안
export async function interpretNotes(
  notes: string,
  places: ParsedPlace[],
  days: number
): Promise<NotesInterpretation | null> {
  const trimmed = notes.trim();
  if (!trimmed) return null;

  const placeList = places.map((p) => ({ id: p.id, name: p.name, category: p.category }));

  const response = await callGemini(
    `여행 일정을 짜는 중입니다. 총 ${days}일 일정이고, 사용자가 적은 요청사항은 다음과 같습니다:

"${trimmed}"

후보 장소 목록(id, 이름, 카테고리):
${JSON.stringify(placeList)}

이 요청사항을 분석해서 두 가지를 판단해줘:
1. mustVisitIds: 요청사항에서 특정 장소(이름 직접 언급) 또는 카테고리를 우선시하라는 의도가 있으면, 해당하는 장소들의 id를 배열로 넣어줘. 없으면 빈 배열.
2. dayCapacity: 요청사항이 하루에 몇 곳을 다닐지(페이스)에 대한 선호를 담고 있으면 숫자로 넣어줘 (예: "여유롭게", "천천히", "많이 안 걸었으면"→2~3, "빡빡하게", "알차게", "많이 가고 싶어"→5~6). 특별한 언급이 없으면 null.

다른 설명 없이 아래 형식의 JSON 객체만 출력해:
{"mustVisitIds": ["id1", "id2"], "dayCapacity": 3}`
  );
  if (!response) return null;

  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const validIds = new Set(places.map((p) => p.id));
    const mustVisitIds = Array.isArray(parsed.mustVisitIds)
      ? parsed.mustVisitIds.filter((id: unknown) => typeof id === "string" && validIds.has(id))
      : [];
    const dayCapacity =
      typeof parsed.dayCapacity === "number" && parsed.dayCapacity > 0 ? Math.round(parsed.dayCapacity) : undefined;
    return { mustVisitIds, dayCapacity };
  } catch {
    return null;
  }
}

export interface AiRecommendedPlace {
  name: string;
  category: Category;
  estimatedCostJPY?: number;
  reason?: string;
}

// 사용자가 직접 입력한 장소 목록 외에, 여행지 기준으로 실제 인기 있고 평이 좋은 장소를 웹 검색으로 찾아 추천한다.
// 결과는 호출측에서 지오코딩 후 ParsedPlace로 변환하며 aiRecommended: true로 표시된다.
export async function recommendAiPlaces(
  destinationLabel: string,
  existingPlaces: ParsedPlace[],
  notes: string,
  days: number,
  locationContext?: string
): Promise<AiRecommendedPlace[]> {
  const existingNames = existingPlaces.map((p) => p.name);
  const maxCount = Math.min(6, Math.max(2, days * 2));
  const baseLocationLine = locationContext
    ? `사용자의 숙소/거점 위치: "${locationContext}" (요청사항에 "도보 10분", "근처", "가까운 곳" 같은 거리 조건이 있으면 반드시 이 위치를 기준으로 실제로 가까운 곳을 찾아줘)`
    : "";

  const response = await callGemini(
    `"${destinationLabel}" 여행 일정(총 ${days}일)을 짜는 중입니다.
${baseLocationLine}

사용자가 이미 넣은 장소 목록: ${JSON.stringify(existingNames)}
사용자 요청사항: "${notes.trim() || "(없음)"}"

실제로 검색해서, 위 목록에 없는 "${destinationLabel}"의 실제로 평이 좋고 인기 있는 장소를 최대 ${maxCount}곳 추천해줘.
요청사항이 있다면 그 취향(예: 카페 위주, 아이와 함께 등)과 거리 조건(가까운 곳, 도보 거리 등)을 우선해줘. 이미 목록에 있는 곳과 겹치지 않게 해줘.
요청사항을 만족하는 기존 장소가 목록에 없다면, 이 추천으로 그 빈자리를 채운다고 생각해줘.

각 장소는 다음 카테고리 중 하나로 분류해: ${CATEGORIES.join(", ")}

다른 설명 없이 아래 형식의 JSON 배열만 출력해:
[{"name": "장소명", "category": "관광", "estimatedCostJPY": 1500, "reason": "추천 이유 한 줄"}]`,
    true
  );
  if (!response) return [];

  try {
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.name === "string" && !existingNames.includes(x.name))
      .map((x) => ({
        name: x.name,
        category: CATEGORIES.includes(x.category) ? x.category : "기타",
        estimatedCostJPY: typeof x.estimatedCostJPY === "number" ? Math.round(x.estimatedCostJPY) : undefined,
        reason: typeof x.reason === "string" ? x.reason : undefined,
      }));
  } catch {
    return [];
  }
}
