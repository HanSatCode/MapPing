import { useLocation, useNavigate } from "react-router-dom";

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const isDashboard = location.pathname === "/dashboard";
  const isResult = location.pathname.startsWith("/result");

  return (
    <nav className="bottom-nav">
      <button className={`bottom-nav-item ${isDashboard ? "active" : ""}`} onClick={() => navigate("/dashboard")}>
        <span className="icon">🏠</span>
        홈
      </button>
      <button className="bottom-nav-fab" onClick={() => navigate("/new/destination")} aria-label="새로운 여행계획 생성">
        +
      </button>
      <button className={`bottom-nav-item ${isResult ? "active" : ""}`} onClick={() => navigate("/dashboard")}>
        <span className="icon">🗺️</span>
        내 일정
      </button>
    </nav>
  );
}
