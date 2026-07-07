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
    <div className="page-fade" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "70vh", gap: 26 }}>
      <div className="pastel-loader" />

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
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

      <div className="dot-bounce">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
