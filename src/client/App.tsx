import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./state/AuthContext";
import AuthPage from "./routes/AuthPage";
import OnboardingPage from "./routes/OnboardingPage";
import PlanPage from "./routes/PlanPage";
import ChatPage from "./routes/ChatPage";
import MemoryPage from "./routes/MemoryPage";
import HistoryPage from "./routes/HistoryPage";
import NavBar from "./components/NavBar";

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="loading-screen">Loading PlanBuddy…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<AuthPage />} />
      </Routes>
    );
  }

  if (!user.homeBaseLabel && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="*" element={<Navigate to="/plan" replace />} />
        </Routes>
      </main>
      {user.homeBaseLabel && <NavBar />}
    </div>
  );
}
