// Google Gemini API 공용 호출 헬퍼. 장소 텍스트 파싱, 요청사항 해석, AI 장소 추천 등
// 여러 곳에서 재사용한다. 브라우저에서 직접 호출하므로 데모/개발 용도로만 사용할 것
// (프로덕션에서는 백엔드 프록시가 필요).
const GEMINI_MODEL = "gemini-2.5-flash-lite";
// flash-lite는 google_search 그라운딩 자체가 자주 503(과부하)이라, 검색이 필요한 호출은 정식 flash로 보낸다.
const GEMINI_SEARCH_MODEL = "gemini-2.5-flash";

export function hasGeminiKey(): boolean {
  return Boolean(import.meta.env.VITE_GEMINI_API_KEY);
}

// 모델이 일시적으로 과부하(503)일 때 재시도할 최대 횟수와 대기 시간
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// useSearch를 true로 주면 Gemini의 google_search 그라운딩 도구를 활성화해서
// 실제 웹 검색 결과를 바탕으로 답하게 한다 (가격 추정, 실제 장소 추천 등에 사용).
export async function callGemini(prompt: string, useSearch = false): Promise<string | null> {
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
