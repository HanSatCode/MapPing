export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const hasGoogleAuth = Boolean(GOOGLE_CLIENT_ID);

let gisScriptPromise: Promise<void> | null = null;

// Google Identity Services 스크립트를 1회만 로드
function loadGisScript(): Promise<void> {
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise((resolve, reject) => {
      if ((window as any).google?.accounts?.id) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google Identity Services 스크립트를 불러오지 못했어요."));
      document.head.appendChild(script);
    });
  }
  return gisScriptPromise;
}

export interface GoogleProfile {
  email: string;
  name: string;
}

function decodeCredential(credential: string): GoogleProfile {
  const payload = JSON.parse(atob(credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  return { email: payload.email, name: payload.name ?? payload.email };
}

// GIS 버튼을 지정한 DOM 노드에 렌더링하고, 로그인 성공 시 프로필을 콜백으로 전달
export async function renderGoogleSignInButton(container: HTMLElement, onSuccess: (profile: GoogleProfile) => void) {
  if (!GOOGLE_CLIENT_ID) return;
  await loadGisScript();
  const google = (window as any).google;
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response: { credential: string }) => onSuccess(decodeCredential(response.credential)),
  });
  google.accounts.id.renderButton(container, { theme: "outline", size: "large", width: 320, text: "continue_with" });
}
