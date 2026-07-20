import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./state/AuthContext";
import { GenerationProvider } from "./state/GenerationContext";
import AuthPage from "./routes/AuthPage";
import OnboardingPage from "./routes/OnboardingPage";
import PlanPage from "./routes/PlanPage";
import ChatPage from "./routes/ChatPage";
import MemoryPage from "./routes/MemoryPage";
import HistoryPage from "./routes/HistoryPage";
import NavBar from "./components/NavBar";
import GenerationBanner from "./components/GenerationBanner";
import FriendsPage from "./routes/FriendsPage";
import InvitePage from "./routes/InvitePage";
import SharedPlanPage from "./routes/SharedPlanPage";
import "./styles/progress.css";

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="loading-screen">Loading PlanBuddy…</div>;
  }

  if (location.pathname.startsWith("/s/")) {
    return <Routes><Route path="/s/:token" element={<SharedPlanPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<AuthPage />} />
      </Routes>
    );
  }

  if (!user.homeBaseLabel && location.pathname !== "/onboarding" && !location.pathname.startsWith("/invite/")) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <GenerationProvider>
      <div className="app-shell">
        <main className="app-main">
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="*" element={<Navigate to="/plan" replace />} />
          </Routes>
        </main>
        {user.homeBaseLabel && <NavBar />}
        <GenerationBanner />
      </div>
    </GenerationProvider>
  );
}
