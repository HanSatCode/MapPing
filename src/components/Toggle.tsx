// 체크박스 대신 쓰는 iOS 스타일 스위치. 라벨 텍스트와 함께 한 줄로 배치된다.
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <span
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        style={{
          position: "relative",
          width: 40,
          height: 22,
          borderRadius: 999,
          background: checked ? "var(--primary)" : "#d5d9e2",
          transition: "background 0.2s ease",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 20 : 2,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
            transition: "left 0.2s ease",
          }}
        />
      </span>
      <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
    </label>
  );
}
