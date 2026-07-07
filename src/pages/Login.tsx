import { useNavigate } from "react-router-dom";
import { login } from "../lib/storage";
import { useEffect, useRef, useState } from "react";
import { hasGoogleAuth, renderGoogleSignInButton } from "../lib/googleAuth";

const ONBOARDING = [
  { icon: "📝", title: "텍스트 분석", desc: "구글 지도에서 복사한 장소 목록만 붙여넣으면 자동으로 장소를 인식해요." },
  { icon: "🗓️", title: "일차별 테마", desc: "쇼핑, 먹거리, 관광 등 원하는 테마로 하루하루를 구성해요." },
  { icon: "🧭", title: "동선 최적화", desc: "가장 효율적인 방문 순서와 이동 수단을 자동으로 계산해요." },
  { icon: "💰", title: "예산 관리", desc: "장소별 예상 비용을 한눈에 보고 직접 수정할 수 있어요." },
];

export default function Login() {
  const navigate = useNavigate();
  const [slide, setSlide] = useState(0);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasGoogleAuth || !googleBtnRef.current) return;
    renderGoogleSignInButton(googleBtnRef.current, (profile) => {
      login({ nickname: profile.name, email: profile.email });
      navigate("/dashboard");
    });
  }, []);

  const handleMockLogin = () => {
    login({ nickname: "여행자", email: "traveler@example.com" });
    navigate("/dashboard");
  };

  return (
    <div className="page-fade" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <div
          style={{
            width: 56,
            height: 56,
            margin: "0 auto 20px",
            borderRadius: 16,
            background: "linear-gradient(135deg, var(--primary), var(--accent))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            boxShadow: "0 10px 24px rgba(59,109,240,0.35)",
          }}
        >
          🗺️
        </div>
        <h1 style={{ fontSize: 30, marginBottom: 8 }}>MapPing</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: 36 }}>저장한 장소로 완성하는 나만의 여행 일정</p>

        <div className="card" style={{ padding: "36px 28px", marginBottom: 28, minHeight: 168 }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>{ONBOARDING[slide].icon}</div>
          <h3 style={{ marginBottom: 10, fontSize: 17 }}>{ONBOARDING[slide].title}</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>{ONBOARDING[slide].desc}</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 7, marginTop: 22 }}>
            {ONBOARDING.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setSlide(idx)}
                aria-label={`슬라이드 ${idx + 1}`}
                style={{
                  width: idx === slide ? 20 : 8,
                  height: 8,
                  borderRadius: 999,
                  border: "none",
                  background: idx === slide ? "var(--primary)" : "#dfe3ec",
                  cursor: "pointer",
                  padding: 0,
                  transition: "all 0.2s ease",
                }}
              />
            ))}
          </div>
        </div>

        {hasGoogleAuth ? (
          <div ref={googleBtnRef} style={{ display: "flex", justifyContent: "center" }} />
        ) : (
          <button
            onClick={handleMockLogin}
            className="btn btn-secondary"
            style={{ width: "100%", padding: "14px 20px", fontSize: 15 }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: "#4285F4",
              }}
            >
              G
            </span>
            Google 계정으로 계속하기 (데모 모드)
          </button>
        )}
      </div>
    </div>
  );
}
