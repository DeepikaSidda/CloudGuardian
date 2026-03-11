import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink, Link, Navigate, useLocation } from "react-router-dom";
import SummaryPage from "./pages/SummaryPage";
import RecommendationsPage from "./pages/RecommendationsPage";
import RecommendationDetailPage from "./pages/RecommendationDetailPage";
import TrendsPage from "./pages/TrendsPage";
import ActionsPage from "./pages/ActionsPage";
import ConfigPage from "./pages/ConfigPage";
import AboutPage from "./pages/AboutPage";
import ActiveServicesPage from "./pages/ActiveServicesPage";
import CostAnomaliesPage from "./pages/CostAnomaliesPage";
import ResourceMapPage from "./pages/ResourceMapPage";
import AssistantPage from "./pages/AssistantPage";
import DependencyGraphPage from "./pages/DependencyGraphPage";
import PoliciesPage from "./pages/PoliciesPage";
import Logo from "./Logo";
import { getSetting } from "./api-client";

const navItems = [
  { to: "/", label: "Dashboard", icon: "📊" },
  { to: "/recommendations", label: "Recommendations", icon: "💡" },
  { to: "/active-services", label: "Active Services", icon: "🔌" },
  { to: "/resource-map", label: "Resource Map", icon: "🗺️" },
  { to: "/dependency-graph", label: "Dependencies", icon: "🔗" },
  { to: "/policies", label: "Policies", icon: "📋" },
  { to: "/cost-anomalies", label: "Cost Anomalies", icon: "🚨" },
  { to: "/trends", label: "Trends", icon: "📈" },
  { to: "/actions", label: "Actions", icon: "⚡" },
  { to: "/config", label: "Settings", icon: "⚙️" },
  { to: "/assistant", label: "Assistant", icon: "🤖" },
];

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('cg_theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cg_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return (
    <BrowserRouter>
      <AppShell theme={theme} toggleTheme={toggleTheme} />
    </BrowserRouter>
  );
}

function AppShell({ theme, toggleTheme }: { theme: string; toggleTheme: () => void }) {
  const location = useLocation();
  const [defaultPage, setDefaultPage] = useState<string | null>(null);
  const [redirectDone, setRedirectDone] = useState(false);

  // Load default landing page on first visit
  useEffect(() => {
    if (location.pathname !== "/") { setRedirectDone(true); return; }
    getSetting<any>("app_settings").then(res => {
      const page = res.value?.defaultPage;
      if (page && page !== "/") setDefaultPage(page);
      else setRedirectDone(true);
    }).catch(() => setRedirectDone(true));
  }, []); // eslint-disable-line

  // If we need to redirect and haven't yet
  if (defaultPage && !redirectDone && location.pathname === "/") {
    setRedirectDone(true);
    return <Navigate to={defaultPage} replace />;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside className="sidebar">
        <Link to="/about" style={{ padding: "16px 16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, textDecoration: "none", transition: "opacity var(--transition-fast)", textAlign: "center" }}>
          <Logo size={200} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>CloudGuardian</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Keep Your Cloud Clean</div>
          </div>
        </Link>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 12px", flex: 1 }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          <span style={{ fontSize: 16 }}>{theme === 'dark' ? '🌙' : '☀️'}</span>
          <span style={{ flex: 1, textAlign: 'left' }}>{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
          <div className={`theme-toggle-track${theme === 'light' ? ' active' : ''}`}>
            <div className="theme-toggle-thumb" />
          </div>
        </button>
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", display: "inline-block", boxShadow: "0 0 6px var(--green)" }} />
            System Online
          </div>
        </div>
      </aside>
      <main style={{ flex: 1, padding: "32px 40px", overflowY: "auto", maxHeight: "100vh" }}>
        <Routes>
          <Route path="/" element={<SummaryPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          <Route path="/recommendations/:id" element={<RecommendationDetailPage />} />
          <Route path="/active-services" element={<ActiveServicesPage />} />
          <Route path="/resource-map" element={<ResourceMapPage />} />
          <Route path="/dependency-graph" element={<DependencyGraphPage />} />
          <Route path="/policies" element={<PoliciesPage />} />
          <Route path="/cost-anomalies" element={<CostAnomaliesPage />} />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/actions" element={<ActionsPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
        </Routes>
      </main>
    </div>
  );
}
