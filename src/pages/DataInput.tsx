import { useNavigate } from "react-router-dom";
import { ProgressBar } from "../components/ProgressBar";
import { useWizard } from "../lib/WizardContext";
import { WIZARD_STEPS } from "../lib/wizardSteps";

export default function DataInput() {
  const navigate = useNavigate();
  const { rawText, setRawText } = useWizard();

  const handleNext = () => {
    if (!rawText.trim()) {
      alert("구글 지도에서 복사한 장소 목록을 붙여넣어주세요.");
      return;
    }
    navigate("/new/days");
  };

  return (
    <div className="page-fade" style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px", width: "100%" }}>
      <ProgressBar steps={WIZARD_STEPS} currentIndex={1} />
      <h2 style={{ marginBottom: 10, fontSize: 22 }}>📍 저장한 장소를 붙여넣어주세요</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: 18, fontSize: 14 }}>
        구글 지도 앱에서 저장된 장소 목록을 복사해서 아래에 붙여넣으면 자동으로 장소를 인식해요.
      </p>
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder={"예시)\n1. 스타벅스 강남점\n2. 광장시장\n3. 남산타워"}
        className="card"
        style={{
          width: "100%",
          minHeight: 320,
          padding: 18,
          fontSize: 14,
          resize: "vertical",
          border: "1px solid var(--border)",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
        <button onClick={() => navigate(-1)} className="btn btn-secondary">
          ← 뒤로
        </button>
        <button onClick={handleNext} className="btn btn-primary">
          다음
        </button>
      </div>
    </div>
  );
}
