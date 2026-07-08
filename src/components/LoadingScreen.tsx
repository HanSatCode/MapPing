import { useEffect, useState } from "react";

interface LoadingScreenProps {
  message: string;
  subMessage?: string;
  ticks?: string[];
}

export function LoadingScreen({ message, subMessage, ticks }: LoadingScreenProps) {
  const [tickIndex, setTickIndex] = useState(0);

  useEffect(() => {
    if (!ticks || ticks.length === 0) return;
    const id = setInterval(() => setTickIndex((i) => (i + 1) % ticks.length), 1400);
    return () => clearInterval(id);
  }, [ticks]);

  return (
    <div className="page-fade loading-overlay" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div className="pop-in loading-card">
        <div className="dot-bounce" style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}>
          <span />
          <span />
          <span />
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", whiteSpace: "pre-line" }}>
          {message}
        </div>
        {subMessage && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>{subMessage}</div>
        )}
        {ticks && ticks.length > 0 && (
          <div key={tickIndex} className="fade-in" style={{ fontSize: 13, color: "var(--primary-dark)", marginTop: 10, fontWeight: 600 }}>
            {ticks[tickIndex]}
          </div>
        )}
      </div>
    </div>
  );
}
