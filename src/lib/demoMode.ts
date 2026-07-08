// VITE_DEMO_MODE=true로 설정하면 Gemini/구글맵 API를 호출하지 않고
// 각 라이브러리에 이미 있는 "키 없음" 폴백 경로(합성 좌표, 규칙 기반 파싱 등)로 흐름만 확인할 수 있다.
export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === "true";
}

// 데모 모드는 폴백 로직이 거의 즉시 끝나서 로딩 화면을 테스트하기 어려우니,
// 데모 모드일 때만 일부러 지연을 넣어 로딩 UI를 눈으로 확인할 수 있게 한다.
const DEMO_LOADING_DELAY_MS = 1500;

export async function demoDelay(): Promise<void> {
  if (!isDemoMode()) return;
  await new Promise((resolve) => setTimeout(resolve, DEMO_LOADING_DELAY_MS));
}
