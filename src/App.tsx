import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { WizardProvider } from "./lib/WizardContext";
import { BottomNav } from "./components/BottomNav";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import DestinationSelect from "./pages/DestinationSelect";
import DataInput from "./pages/DataInput";
import DaysBasecampSetup from "./pages/DaysBasecampSetup";
import ParsingLoading from "./pages/ParsingLoading";
import ThemeSelection from "./pages/ThemeSelection";
import GeneratingLoading from "./pages/GeneratingLoading";
import Result from "./pages/Result";

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
        <Route path="/new/parsing" element={<ParsingLoading />} />
        <Route path="/new/theme" element={<ThemeSelection />} />
        <Route path="/new/generating" element={<GeneratingLoading />} />
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
