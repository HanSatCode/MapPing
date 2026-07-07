interface ProgressBarProps {
  steps: string[];
  currentIndex: number;
}

export function ProgressBar({ steps, currentIndex }: ProgressBarProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 36 }}>
      {steps.map((step, idx) => (
        <div key={step} style={{ display: "flex", alignItems: "center", gap: 8, flex: idx < steps.length - 1 ? 1 : undefined }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                background: idx <= currentIndex ? "linear-gradient(135deg, var(--primary), #5b7ff5)" : "#e9ecf3",
                color: idx <= currentIndex ? "#fff" : "#9aa1af",
                boxShadow: idx === currentIndex ? "0 4px 10px rgba(59,109,240,0.35)" : "none",
                transition: "all 0.2s ease",
              }}
            >
              {idx < currentIndex ? "✓" : idx + 1}
            </div>
            <span style={{ fontSize: 13, fontWeight: idx === currentIndex ? 700 : 500, color: idx <= currentIndex ? "var(--text)" : "#adb3c2", whiteSpace: "nowrap" }}>
              {step}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div style={{ flex: 1, height: 2, borderRadius: 2, background: idx < currentIndex ? "var(--primary)" : "#e9ecf3", transition: "background 0.2s ease" }} />
          )}
        </div>
      ))}
    </div>
  );
}
