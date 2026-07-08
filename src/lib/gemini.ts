// Google Gemini API 공용 호출 헬퍼. 장소 텍스트 파싱, 요청사항 해석, AI 장소 추천 등
// 여러 곳에서 재사용한다. 브라우저에서 직접 호출하므로 데모/개발 용도로만 사용할 것
// (프로덕션에서는 백엔드 프록시가 필요).
import { isDemoMode } from "./demoMode";
const GEMINI_MODEL = "gemini-2.5-flash-lite";
// flash-lite는 google_search 그라운딩 자체가 자주 503(과부하)이라, 검색이 필요한 호출은 정식 flash로 보낸다.
const GEMINI_SEARCH_MODEL = "gemini-2.5-flash";

export function hasGeminiKey(): boolean {
  if (isDemoMode()) return false;
  return Boolean(import.meta.env.VITE_GEMINI_API_KEY);
}

// 모델이 일시적으로 과부하(503)일 때 재시도할 최대 횟수와 대기 시간
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 여행 정보를 바탕으로 어울리는 여행 일정 제목을 Gemini에게 짧게 지어달라고 요청한다.
// 실패하거나 API 키가 없으면 null을 반환하니, 호출 측에서 기본 제목으로 폴백해야 한다.
export async function generateItineraryTitle(
  destinationLabel: string,
  days: number,
  placeNames: string[]
): Promise<string | null> {
  const sample = placeNames.slice(0, 8).join(", ");
  const prompt = [
    `다음 여행 일정에 어울리는, 감각 있고 기억에 남는 제목을 딱 하나만 지어줘.`,
    `여행지: ${destinationLabel}`,
    `기간: ${days}일`,
    sample ? `주요 방문 장소: ${sample}` : "",
    `조건:`,
    `- 15자 이내의 한국어 제목`,
    `- 뻔한 "OO 여행", "OO 일정" 같은 밋밋한 표현 대신, 여행지/장소 특징을 살린 위트 있고 개성 있는 표현 사용`,
    `- 이모지는 넣지 말고 텍스트만`,
    `- 설명이나 따옴표 없이 제목 텍스트만 출력`,
  ]
    .filter(Boolean)
    .join("\n");

  // flash-lite는 무료 할당량(하루 20회)이 다른 호출들과 공유되어 금방 소진되므로,
  // 별도 할당량을 쓰는 flash로 호출해 실패 확률을 낮춘다.
  const text = await callGemini(prompt, true);
  if (!text) return null;

  const title = text.split("\n")[0].trim().replace(/^["'“”]+|["'“”]+$/g, "");
  return title || null;
}

// useSearch를 true로 주면 Gemini의 google_search 그라운딩 도구를 활성화해서
// 실제 웹 검색 결과를 바탕으로 답하게 한다 (가격 추정, 실제 장소 추천 등에 사용).
export async function callGemini(prompt: string, useSearch = false): Promise<string | null> {
  if (isDemoMode()) return null;
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = useSearch ? GEMINI_SEARCH_MODEL : GEMINI_MODEL;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            ...(useSearch ? { tools: [{ google_search: {} }] } : {}),
          }),
        }
      );
      if (!res.ok) {
        // 503(모델 과부하)/429(요청 과다)는 일시적일 가능성이 높으니 잠시 후 재시도
        if ((res.status === 503 || res.status === 429) && attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        console.warn(`Gemini API 호출 실패: ${res.status}`);
        return null;
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p: any) => p.text ?? "").join("\n").trim();
      return text || null;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      console.warn("Gemini API 호출 중 오류", err);
      return null;
    }
  }
  return null;
}
