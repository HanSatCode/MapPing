import { callGemini, hasGeminiKey } from "./gemini";
import type { ItineraryDay, ParsedPlace } from "../types";

// API 키가 없거나(데모 모드 포함) 호출에 실패했을 때 쓰는, 이미 갖고 있는 데이터 기반 규칙형 설명
function fallbackCuration(day: ItineraryDay, places: Map<string, ParsedPlace>, totalDays: number): string {
  const intro = `${day.dayIndex}일차${totalDays > 1 ? ` (총 ${totalDays}일 중 ${day.dayIndex}번째 날)` : ""}${day.theme ? `는 '${day.theme}' 테마로 구성했어요.` : "는 특별한 테마 없이 자유롭게 구성했어요."}`;
  const lines = day.visits.map((v, i) => {
    const p = places.get(v.placeId);
    if (!p) return "";
    const reasons: string[] = [];
    if (p.mustVisit) reasons.push("꼭 가고 싶다고 직접 표시하신 곳이에요");
    if (p.aiRecommended) reasons.push(p.aiReason ? `AI가 "${p.aiReason}"라는 이유로 추천한 곳이에요` : "요청사항을 반영해 AI가 추천한 곳이에요");
    if (day.theme && p.category === day.theme) reasons.push(`이 날의 테마인 '${day.theme}'와 잘 어울려요`);
    if (i === 0) reasons.push("숙소/출발지에서 가장 가까워 첫 방문지로 배치했어요");
    else reasons.push(`바로 앞 장소에서 이동하기 좋은 위치라 ${i + 1}번째로 배치했어요`);
    return `[${p.name}]\n${reasons.join(", ")}.`;
  });
  return [intro, ...lines.filter(Boolean)].join("\n\n");
}

export async function generateDayCuration(
  destinationLabel: string,
  day: ItineraryDay,
  places: Map<string, ParsedPlace>,
  notes: string,
  totalDays: number
): Promise<string> {
  if (!hasGeminiKey()) return fallbackCuration(day, places, totalDays);

  const placeLines = day.visits
    .map((v, i) => {
      const p = places.get(v.placeId);
      if (!p) return "";
      const tags = [
        p.mustVisit ? "꼭 가고 싶다고 직접 표시함" : null,
        p.aiRecommended ? `AI 추천${p.aiReason ? ` (추천 이유: ${p.aiReason})` : ""}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `${i + 1}. ${p.name} (카테고리: ${p.category}${tags ? `, ${tags}` : ""})`;
    })
    .filter(Boolean)
    .join("\n");

  if (!placeLines) return "";

  const prompt = [
    `여행지: ${destinationLabel}`,
    `이것은 총 ${totalDays}일 여행 일정 중 ${day.dayIndex}일차입니다. (1일차가 아니면 "첫날"이라는 표현을 쓰지 말고 반드시 "${day.dayIndex}일차"라고 지칭해줘.)`,
    day.theme ? `이 날의 테마: ${day.theme}` : "",
    notes.trim() ? `여행자 요청사항: ${notes.trim()}` : "",
    `이 날 방문하는 장소들 (방문 순서대로, 괄호 안은 이 장소에 대해 이미 알고 있는 정보):`,
    placeLines,
    "",
    `먼저 "${day.dayIndex}일차는 ~"로 시작하는 1~2문장짜리 전체 요약을 적어줘 (이 날의 분위기/테마/동선 흐름을 간단히).`,
    "그다음 장소마다 왜 이 날 일정에 '추천'되었는지를 명확하고 구체적으로 밝혀줘. 절대 뭉뚱그리지 말고, 각 장소마다 아래 내용을 자연스럽게 하나의 긴 문단(6~8문장 이상)으로 녹여서 충분히 자세하게 써줘:",
    "- 왜 이 장소인가: 위에 주어진 정보(꼭 가고 싶다고 표시함/AI 추천 이유/카테고리)가 있으면 반드시 그걸 근거로 구체적으로 설명하고, 없으면 그 장소·카테고리의 특징(무엇을 즐길 수 있는 곳인지, 어떤 메뉴/볼거리가 있는지)을 근거로 설명해줘.",
    "- 왜 이 순서인가: 바로 앞/뒤 장소와 비교해 동선·이동 효율 관점에서 왜 이 위치에 배치했는지.",
    "- 실용 팁: 그 장소에서 구체적으로 뭘 하면 좋을지, 뭘 놓치지 말아야 할지, 시간을 얼마나 쓰면 좋을지 등.",
    "'좋은 곳이에요', '추천드려요' 같은 근거 없는 뭉뚱그린 문장은 쓰지 말고, 항상 구체적인 이유를 먼저 제시한 뒤 결론을 말하는 식으로 써줘.",
    "",
    "형식: 마크다운 볼드(**) 쓰지 말고, 장소명을 대괄호로 감싸서([장소명]) 첫 줄에 적은 다음, 줄바꿈하고 설명 문단을 이어서 적어줘. 장소 사이는 빈 줄로 구분해줘. 예시 톤(분량은 이 예시보다 더 길게):",
    "[카와바타 상점가]",
    "쇼핑 겸 맛있는 간식거리들을 쟁여두고 싶다면 이곳을 추천해요. 다양한 종류의 육류와 반찬, 디저트까지 있어서 후쿠오카의 맛있는 것들을 둘러보기 좋아요. 이치란 캐널시티 하카타점에서 도보로 5분 거리라 첫 일정을 마치고 바로 이어서 들르기 좋은 동선이에요. 저녁 식사 전에 간단한 주전부리를 사서 먹으며 시장 특유의 활기찬 분위기를 느껴보세요.",
    "",
    "위 예시 톤을 참고하되, 각 장소마다 예시보다 더 길고 자세하게(6~8문장 이상) 실제 사실에 기반해 구체적이고 자연스럽게 문단 형태로 써줘. 다른 날짜나 다른 일차 이야기는 하지 마.",
  ]
    .filter(Boolean)
    .join("\n");

  // flash-lite는 "6~8문장으로 길게" 같은 분량 지시를 잘 안 따르고 짧게 쓰는 경향이 있어서,
  // 더 지시를 잘 따르는 flash 모델을 쓴다 (useSearch=true가 모델 선택도 겸함).
  const text = await callGemini(prompt, true);
  return text || fallbackCuration(day, places, totalDays);
}
