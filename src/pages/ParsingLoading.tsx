import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LoadingScreen } from "../components/LoadingScreen";
import { useWizard } from "../lib/WizardContext";
import { parsePlacesFromText } from "../lib/parsePlaces";
import { getDestination } from "../lib/destinations";

export default function ParsingLoading() {
  const navigate = useNavigate();
  const { rawText, destination, setPlaces } = useWizard();

  useEffect(() => {
    if (!rawText.trim()) {
      navigate("/new/input");
      return;
    }
    let cancelled = false;
    (async () => {
      const center = getDestination(destination);
      const places = await parsePlacesFromText(rawText, center);
      if (cancelled) return;
      if (places.length === 0) {
        alert("장소를 찾지 못했어요. 텍스트를 다시 확인해주세요.");
        navigate("/new/input");
        return;
      }
      setPlaces(places);
      navigate("/new/theme");
    })();
    return () => {
      cancelled = true;
    };
  }, [rawText]);

  return (
    <LoadingScreen
      message="붙여넣은 텍스트에서 장소를 찾는 중입니다..."
      subMessage="장소명, 좌표, 가격 수준을 추출하고 있어요"
      ticks={["텍스트 조각을 분석하고 있어요", "장소명을 인식하고 있어요", "좌표를 계산하고 있어요", "가격대를 추정하고 있어요"]}
    />
  );
}
