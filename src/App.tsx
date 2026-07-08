import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { WizardProvider } from "./lib/WizardContext";
import { BottomNav } from "./components/BottomNav";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import DestinationSelect from "./pages/DestinationSelect";
import DataInput from "./pages/DataInput";
import DaysBasecampSetup from "./pages/DaysBasecampSetup";
import ThemeSelection from "./pages/ThemeSelection";
import Result from "./pages/Result";
import { LoadingScreen } from "./components/LoadingScreen";

function AppRoutes() {
  const location = useLocation();
  const showBottomNav = location.pathname === "/dashboard" || location.pathname.startsWith("/result");

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/new/destination" element={<DestinationSelect />} />
        <Route path="/new/input" element={<DataInput />} />
        <Route path="/new/days" element={<DaysBasecampSetup />} />
        <Route path="/new/theme" element={<ThemeSelection />} />
        <Route
          path="/preview/loading"
          element={
            <LoadingScreen
              message={"테마에 맞춰 동선을 최적화하고\n예산을 계산하고 있어요"}
              subMessage="잠시만 기다려주세요"
              ticks={["일차별로 장소를 배분하고 있어요", "최적 동선을 계산하고 있어요", "이동 시간과 교통비를 산출하고 있어요", "예산을 정리하고 있어요"]}
            />
          }
        />
        <Route path="/result/:id" element={<Result />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      {showBottomNav && <BottomNav />}
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <WizardProvider>
        <AppRoutes />
      </WizardProvider>
    </BrowserRouter>
  );
}

export default App;
