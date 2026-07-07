import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteItinerary, duplicateItinerary, getSession, importItineraryFromJSON, listItinerarySummaries, logout } from "../lib/storage";
import type { ItinerarySummary } from "../types";

function formatJPY(amount: number) {
  return `¥${amount.toLocaleString("ko-KR")}`;
}

const THUMB_GRADIENTS = [
  "linear-gradient(135deg,#5b7ff5,#3b6df0)",
  "linear-gradient(135deg,#22c3a6,#1aa88f)",
  "linear-gradient(135deg,#ff9770,#ef5da8)",
  "linear-gradient(135deg,#7c5cf0,#4a7bf7)",
];

export default function Dashboard() {
  const navigate = useNavigate();
  const session = getSession();
  const [items, setItems] = useState<ItinerarySummary[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => setItems(listItinerarySummaries());

  useEffect(() => {
    if (!session) {
      navigate("/login");
      return;
    }
    refresh();
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleDelete = (id: string) => {
    if (confirm("이 일정을 삭제할까요?")) {
      deleteItinerary(id);
      refresh();
    }
    setOpenMenuId(null);
  };

  const handleDuplicate = (id: string) => {
    duplicateItinerary(id);
    refresh();
    setOpenMenuId(null);
  };

  const handleShare = (id: string) => {
    const url = `${window.location.origin}/result/${id}?shared=1`;
    navigator.clipboard?.writeText(url).catch(() => {});
    alert(`공유 링크가 복사되었습니다:\n${url}`);
    setOpenMenuId(null);
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const imported = importItineraryFromJSON(text);
      refresh();
      navigate(`/result/${imported.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "일정 파일을 불러오지 못했어요.");
    }
  };

  return (
    <div className="page-fade with-bottom-nav" style={{ maxWidth: 1000, margin: "0 auto", padding: "36px 24px", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 36 }}>
        <div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>안녕하세요 👋</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{session?.nickname ?? "여행자"}님</div>
        </div>
        <button onClick={handleLogout} className="btn btn-ghost" style={{ padding: "8px 14px" }}>
          로그아웃
        </button>
      </div>

      <button
        onClick={() => navigate("/new/destination")}
        className="btn btn-primary"
        style={{ width: "100%", padding: "20px", fontSize: 16, marginBottom: 12, borderRadius: "var(--radius-md)" }}
      >
        ✨ 새로운 여행계획 생성
      </button>
      <button
        onClick={handleImportClick}
        className="btn btn-ghost"
        style={{ width: "100%", padding: "14px", fontSize: 14, marginBottom: 40, borderRadius: "var(--radius-md)" }}
      >
        📂 JSON 파일로 여행계획 불러오기
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportFile}
        style={{ display: "none" }}
      />

      <h3 style={{ marginBottom: 16, fontSize: 16 }}>내 일정</h3>
      {items.length === 0 && (
        <div className="card" style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🧳</div>
          아직 생성된 일정이 없어요. 첫 여행 일정을 만들어보세요!
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 18 }}>
        {items.map((item, idx) => (
          <div
            key={item.id}
            className="card card-hover pop-in"
            style={{ position: "relative", overflow: "hidden", cursor: "pointer", animationDelay: `${idx * 50}ms` }}
            onClick={() => navigate(`/result/${item.id}`)}
          >
            <div style={{ height: 96, background: THUMB_GRADIENTS[idx % THUMB_GRADIENTS.length], position: "relative" }}>
              <span style={{ position: "absolute", left: 14, bottom: 10, fontSize: 24 }}>🗺️</span>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{item.title}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{item.days}일 · 장소 {item.placeCount}개</div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 8, color: "var(--primary-dark)" }}>{formatJPY(item.totalBudget)}</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenuId(openMenuId === item.id ? null : item.id);
              }}
              style={{ position: "absolute", top: 10, right: 10, background: "#ffffffe6", border: "1px solid var(--border)", borderRadius: 8, width: 30, height: 30, cursor: "pointer", boxShadow: "var(--shadow-sm)" }}
            >
              ⋮
            </button>
            {openMenuId === item.id && (
              <div
                ref={menuRef}
                onClick={(e) => e.stopPropagation()}
                className="card"
                style={{ position: "absolute", top: 46, right: 10, overflow: "hidden", zIndex: 10, boxShadow: "var(--shadow-lg)" }}
              >
                <MenuItem label="수정" onClick={() => navigate(`/result/${item.id}`)} />
                <MenuItem label="복제" onClick={() => handleDuplicate(item.id)} />
                <MenuItem label="공유" onClick={() => handleShare(item.id)} />
                <MenuItem label="삭제" onClick={() => handleDelete(item.id)} danger />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={danger ? "btn-danger" : ""}
      style={{
        display: "block",
        width: "100%",
        padding: "10px 20px",
        border: "none",
        background: "none",
        textAlign: "left",
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontSize: 14,
      }}
    >
      {label}
    </button>
  );
}
