import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ProgressBar } from "../components/ProgressBar";
import { WIZARD_STEPS } from "../lib/wizardSteps";
import { DESTINATIONS, type DestinationId } from "../lib/destinations";
import { useWizard } from "../lib/WizardContext";

export default function DestinationSelect() {
  const navigate = useNavigate();
  const { destination, setDestination } = useWizard();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Partial<Record<DestinationId, HTMLButtonElement | null>>>({});
  const scrollTimer = useRef<number | undefined>(undefined);

  const scrollToItem = (id: DestinationId, behavior: ScrollBehavior = "smooth") => {
    const el = itemRefs.current[id];
    const track = trackRef.current;
    if (!el || !track) return;
    const offset = el.offsetLeft - track.clientWidth / 2 + el.clientWidth / 2;
    track.scrollTo({ left: offset, behavior });
  };

  useEffect(() => {
    scrollToItem(destination, "auto");
  }, []);

  const handleScroll = () => {
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      const track = trackRef.current;
      if (!track) return;
      const center = track.scrollLeft + track.clientWidth / 2;
      let closest: DestinationId = DESTINATIONS[0].id;
      let closestDist = Infinity;
      for (const d of DESTINATIONS) {
        const el = itemRefs.current[d.id];
        if (!el) continue;
        const dist = Math.abs(el.offsetLeft + el.clientWidth / 2 - center);
        if (dist < closestDist) {
          closestDist = dist;
          closest = d.id;
        }
      }
      setDestination(closest);
    }, 120);
  };

  const handlePick = (id: DestinationId) => {
    setDestination(id);
    scrollToItem(id);
  };

  return (
    <div className="page-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px", width: "100%" }}>
      <ProgressBar steps={WIZARD_STEPS} currentIndex={0} />
      <h2 style={{ marginBottom: 8, fontSize: 22 }}>✈️ 어디로 여행하시나요?</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: 8, fontSize: 14 }}>
        선택한 여행지를 기준으로 장소를 더 정확하게 찾아드려요.
      </p>

      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="dial-track"
        style={{
          display: "flex",
          gap: 20,
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          padding: "28px calc(50% - 70px)",
          marginBottom: 8,
        }}
      >
        {DESTINATIONS.map((d) => {
          const active = d.id === destination;
          return (
            <button
              key={d.id}
              ref={(el) => {
                itemRefs.current[d.id] = el;
              }}
              onClick={() => handlePick(d.id)}
              style={{
                scrollSnapAlign: "center",
                flexShrink: 0,
                width: 140,
                height: 140,
                borderRadius: "50%",
                border: active ? "3px solid var(--primary)" : "1px solid var(--border)",
                background: active ? "var(--primary-light)" : "#fff",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                cursor: "pointer",
                transform: active ? "scale(1.08)" : "scale(0.88)",
                opacity: active ? 1 : 0.5,
                transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                boxShadow: active ? "0 10px 24px rgba(59,109,240,0.25)" : "none",
              }}
            >
              <span style={{ fontSize: 40 }}>{d.emoji}</span>
              <span style={{ fontWeight: 800, fontSize: 16, color: active ? "var(--primary-dark)" : "var(--text-muted)" }}>{d.label}</span>
            </button>
          );
        })}
      </div>
      <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12, marginBottom: 32 }}>
        좌우로 넘기거나 눌러서 선택해주세요
      </p>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button onClick={() => navigate(-1)} className="btn btn-secondary">
          ← 뒤로
        </button>
        <button onClick={() => navigate("/new/input")} className="btn btn-primary">
          다음
        </button>
      </div>
    </div>
  );
}
