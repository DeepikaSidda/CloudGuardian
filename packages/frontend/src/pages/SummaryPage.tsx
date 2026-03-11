import { useState, useEffect, useCallback, useRef } from "react";
import { getSummary, triggerScan, getScans, getRecommendations, createPoller, getBilling, getTrends, getSetting, type DashboardSummary, type BillingData, type TrendEntry } from "../api-client";
import type { ScanRecord, Recommendation } from "@governance-engine/shared";
import { Link } from "react-router-dom";
import { playSuccessSound, playErrorSound } from "../utils/sounds";
import LoadingSpinner from "../components/LoadingSpinner";

// Animated counter hook
function useAnimatedNumber(target: number, duration = 1200) {
  const [val, setVal] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const start = ref.current;
    const diff = target - start;
    if (diff === 0) return;
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = Math.round(start + diff * eased);
      setVal(current);
      ref.current = current;
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return val;
}

export default function SummaryPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [trends, setTrends] = useState<TrendEntry[]>([]);
  const soundEnabledRef = useRef(false);
  const showToastOnScanCompleteRef = useRef(true);
  const showToastOnErrorsRef = useRef(true);
  const showBillingSectionRef = useRef(true);
  const [showBilling, setShowBilling] = useState(true);
  const refreshIntervalRef = useRef(30_000);
  const pollerRef = useRef<{ start: () => void; stop: () => void; setInterval: (ms: number) => void } | null>(null);
  const prevScanStatusesRef = useRef<Record<string, string>>({});
  const toastDurationRef = useRef(5);
  const timezoneRef = useRef("UTC");
  const budgetThresholdRef = useRef(0);
  const [budgetAlert, setBudgetAlert] = useState(false);

  // Load app settings on mount
  useEffect(() => {
    getSetting<any>("app_settings").then(res => {
      const v = res.value;
      if (!v) return;
      soundEnabledRef.current = !!v.soundEnabled;
      showToastOnScanCompleteRef.current = v.showToastOnScanComplete !== false;
      showToastOnErrorsRef.current = v.showToastOnErrors !== false;
      showBillingSectionRef.current = v.showBillingSection !== false;
      setShowBilling(v.showBillingSection !== false);
      toastDurationRef.current = v.toastDuration ?? 5;
      timezoneRef.current = v.timezone ?? "UTC";
      budgetThresholdRef.current = v.budgetThreshold ?? 0;
      const interval = (v.dashboardRefreshInterval ?? 30) * 1000;
      if (interval > 0 && interval !== refreshIntervalRef.current) {
        refreshIntervalRef.current = interval;
        pollerRef.current?.setInterval(interval);
      } else if (interval === 0) {
        pollerRef.current?.stop();
      }
    }).catch(() => {});
  }, []);

  useEffect(() => { setTimeout(() => setMounted(true), 100); }, []);

  // Detect scan completion/failure by comparing previous vs current scan statuses
  useEffect(() => {
    if (scans.length === 0) return;
    const prev = prevScanStatusesRef.current;
    for (const scan of scans) {
      const oldStatus = prev[scan.scanId];
      if (oldStatus && oldStatus !== scan.status) {
        if (scan.status === "COMPLETED") {
          if (soundEnabledRef.current) playSuccessSound();
          if (showToastOnScanCompleteRef.current) setScanMessage(`Scan completed — ${scan.recommendationCount} finding${scan.recommendationCount !== 1 ? "s" : ""}`);
        } else if (scan.status === "FAILED") {
          if (soundEnabledRef.current) playErrorSound();
          if (showToastOnErrorsRef.current) setScanMessage(`Scan failed — ${scan.scanId.slice(0, 8)}...`);
        }
      }
    }
    // Update tracked statuses
    const next: Record<string, string> = {};
    for (const s of scans) next[s.scanId] = s.status;
    prevScanStatusesRef.current = next;
  }, [scans]);

  // Auto-dismiss toast based on toastDuration setting
  useEffect(() => {
    if (!scanMessage) return;
    const dur = toastDurationRef.current;
    if (dur <= 0) return; // 0 = until dismissed
    const timer = setTimeout(() => setScanMessage(null), dur * 1000);
    return () => clearTimeout(timer);
  }, [scanMessage]);

  // Check budget threshold when billing data loads
  useEffect(() => {
    if (billing && budgetThresholdRef.current > 0) {
      setBudgetAlert(billing.projectedTotal > budgetThresholdRef.current);
    } else {
      setBudgetAlert(false);
    }
  }, [billing]);

  const fetchAll = useCallback(async () => {
    try {
      const [s, sc, rc, b, t] = await Promise.all([getSummary(), getScans(), getRecommendations(), getBilling().catch(() => null), getTrends().catch(() => [])]);
      setSummary(s); setScans(sc); setRecs(rc); setBilling(b); setTrends(t as TrendEntry[]); setError(null);
    } catch (err: any) { setError(err.message || "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); const p = createPoller(fetchAll, refreshIntervalRef.current); pollerRef.current = p; p.start(); return () => p.stop(); }, [fetchAll]);

  const handleScan = async () => {
    setScanning(true); setScanMessage(null);
    try {
      const { scanId } = await triggerScan();
      setScanMessage(`Scan started — ${scanId.slice(0, 8)}...`);
      if (soundEnabledRef.current) playSuccessSound();
      setTimeout(fetchAll, 5000); setTimeout(fetchAll, 15000); setTimeout(fetchAll, 30000);
    } catch (err: any) {
      setScanMessage(`Failed: ${err.message}`);
      if (soundEnabledRef.current) playErrorSound();
    }
    finally { setScanning(false); }
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return <div className="page-enter"><div className="toast toast-error">⚠️ {error}</div></div>;
  if (!summary) return null;

  const totalRecs = Object.values(summary.countsByAdvisor).reduce((a, b) => a + b, 0);
  const high = summary.countsByRiskLevel["High"] ?? 0;
  const med = summary.countsByRiskLevel["Medium"] ?? 0;
  const low = summary.countsByRiskLevel["Low"] ?? 0;
  const healthScore = totalRecs === 0 ? 100 : Math.max(0, Math.round(100 - (high * 10 + med * 4 + low * 1)));
  const healthColor = healthScore >= 80 ? "var(--green)" : healthScore >= 50 ? "var(--yellow)" : "var(--red)";
  const healthLabel = healthScore >= 80 ? "Healthy" : healthScore >= 50 ? "Needs Attention" : "Critical";

  const recentScans = [...scans].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()).slice(0, 5);

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      {/* Floating background orbs */}
      <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08), transparent 70%)", animation: "float1 8s ease-in-out infinite", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: -40, left: -40, width: 160, height: 160, borderRadius: "50%", background: "radial-gradient(circle, rgba(6,182,212,0.06), transparent 70%)", animation: "float2 10s ease-in-out infinite", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "40%", right: "20%", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.05), transparent 70%)", animation: "float3 12s ease-in-out infinite", pointerEvents: "none" }} />

      <div className="page-enter" style={{ position: "relative", zIndex: 1 }}>
        {/* Hero */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32, opacity: mounted ? 1 : 0, transform: mounted ? "translateY(0)" : "translateY(20px)", transition: "all 0.6s cubic-bezier(0.16, 1, 0.3, 1)" }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>
              Welcome back <span style={{ display: "inline-block", animation: "wave 2s ease-in-out infinite", transformOrigin: "70% 70%" }}>👋</span>
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
              {summary.lastScanTimestamp ? `Last scan ${timeAgo(summary.lastScanTimestamp, timezoneRef.current)}` : "No scans yet — run your first scan"}
            </p>
          </div>
          <button className="btn-primary" onClick={handleScan} disabled={scanning} style={{ position: "relative", overflow: "hidden" }}>
            {scanning ? <><span className="spinner" /> Scanning...</> : <>🔍 Run Scan</>}
          </button>
        </div>

        {scanMessage && (
          <div className={`toast ${scanMessage.startsWith("Failed") ? "toast-error" : "toast-success"}`} style={{ marginBottom: 20, padding: "14px 20px", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 10, boxShadow: scanMessage.startsWith("Failed") ? "0 0 20px rgba(239,68,68,0.25)" : "0 0 20px rgba(34,197,94,0.25)" }}>
            <span style={{ fontSize: 18 }}>{scanMessage.startsWith("Failed") ? "❌" : "🚀"}</span>
            {scanMessage}
            <button onClick={() => setScanMessage(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16, opacity: 0.7 }}>✕</button>
          </div>
        )}

        {budgetAlert && billing && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div className="toast toast-error" style={{ margin: 0, padding: "14px 20px", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <span style={{ fontSize: 18 }}>💸</span>
              Budget Alert — Projected cost ${billing.projectedTotal.toFixed(2)} exceeds your ${budgetThresholdRef.current} threshold
            </div>
            <div className="glass-card" style={{ margin: 0, padding: "14px 20px", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>🏢</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{summary.accountInfo?.accountName ?? "AWS Account"}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>{summary.accountInfo?.accountId ?? "—"}</div>
              </div>
            </div>
          </div>
        )}

        {/* Health Score + Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16, marginBottom: 20 }}>
          <HealthRing score={healthScore} color={healthColor} label={healthLabel} mounted={mounted} />
          <div className="stagger-children" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <AnimatedStatCard icon="💡" label="Total Findings" value={totalRecs} color="var(--accent-light)" desc={totalRecs === 0 ? "All clear" : `${high} critical`} delay={0.1} pct={totalRecs > 0 ? Math.min((totalRecs / 200) * 100, 100) : 0} />
            <AnimatedStatCard icon="🔴" label="High Risk" value={high} color="var(--red)" desc={high === 0 ? "No critical issues" : "Needs immediate action"} delay={0.2} pct={totalRecs > 0 ? (high / totalRecs) * 100 : 0} />
            <AnimatedStatCard icon="💰" label="Potential Savings" value={summary.totalCostSavings} color="var(--green)" desc={summary.totalCostSavings === 0 ? "No idle costs detected" : "Estimated monthly"} prefix="$" delay={0.3} pct={summary.totalCostSavings > 0 ? Math.min((summary.totalCostSavings / 500) * 100, 100) : 0} />
            <AnimatedStatCard icon="📊" label="Resources Evaluated" value={summary.totalResourcesEvaluated} color="var(--cyan)" desc={`Across ${scans.length} scan${scans.length !== 1 ? "s" : ""}`} delay={0.4} pct={scans.length > 0 ? Math.min((scans.length / 20) * 100, 100) : 0} />
          </div>
        </div>

        {/* Billing & Cost Section */}
        {showBilling && billing && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, marginBottom: 20 }}>
            {/* Current Bill Card — filled layout */}
            <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 0 }}>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 14 }}>💳 Current Month Bill</h3>
              {/* Big amount */}
              <div style={{ fontSize: 38, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1 }}>
                ${billing.currentMonthCost.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                {billing.currentMonth} · Day {billing.daysElapsed} of {billing.daysInMonth}
              </div>
              {/* Month progress bar */}
              <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(billing.daysElapsed / billing.daysInMonth) * 100}%`, background: "var(--gradient-2)", borderRadius: 2, transition: "width 0.6s ease" }} />
              </div>
              {/* Budget ring — daily burn rate visual */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
                  <svg width="52" height="52" viewBox="0 0 52 52">
                    <circle cx="26" cy="26" r="20" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
                    <circle cx="26" cy="26" r="20" fill="none"
                      stroke={billing.monthOverMonthChange > 20 ? "var(--red)" : billing.monthOverMonthChange > 0 ? "var(--orange)" : "var(--green)"}
                      strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={`${Math.min((billing.daysElapsed / billing.daysInMonth) * 125.7, 125.7)} 125.7`}
                      style={{ transform: "rotate(-90deg)", transformOrigin: "center", filter: `drop-shadow(0 0 4px ${billing.monthOverMonthChange > 20 ? "var(--red)" : billing.monthOverMonthChange > 0 ? "var(--orange)" : "var(--green)"})` }} />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "var(--text-primary)" }}>
                    {Math.round((billing.daysElapsed / billing.daysInMonth) * 100)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Daily Burn Rate</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                    ${billing.daysElapsed > 0 ? (billing.currentMonthCost / billing.daysElapsed).toFixed(2) : "0.00"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>per day avg</div>
                </div>
              </div>
              {/* Projected + vs Last Month */}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <div style={{ flex: 1, padding: "10px 12px", borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>Projected</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--accent-light)" }}>${billing.projectedTotal.toFixed(2)}</div>
                </div>
                <div style={{ flex: 1, padding: "10px 12px", borderRadius: 8, background: billing.monthOverMonthChange > 0 ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)", border: `1px solid ${billing.monthOverMonthChange > 0 ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)"}` }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>vs Last Month</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: billing.monthOverMonthChange > 0 ? "var(--red)" : "var(--green)" }}>
                    {billing.monthOverMonthChange > 0 ? "↑" : "↓"} {Math.abs(billing.monthOverMonthChange)}%
                  </div>
                </div>
              </div>
              {/* Forecast range */}
              {billing.forecastLow !== null && billing.forecastHigh !== null && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)" }}>
                  📊 Forecast: ${billing.forecastLow.toFixed(2)} – ${billing.forecastHigh.toFixed(2)}
                </div>
              )}
            </div>

            {/* Right column — Spending Line Chart + Service Breakdown */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Monthly Spending Line/Area Chart */}
              <div className="glass-card" style={{ padding: "18px 24px" }}>
                <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>📈 Monthly Spending History</h3>
                <div style={{ maxHeight: 140 }}>
                  <SpendingChart history={billing.monthlyHistory} currentMonth={billing.currentMonth} />
                </div>
              </div>

              {/* Top Services */}
              <div className="glass-card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>🏷️ Top Services by Cost</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {billing.serviceBreakdown.slice(0, 6).map((s, i) => {
                    const maxSvc = billing!.serviceBreakdown[0]?.amount ?? 1;
                    return (
                      <div key={s.service} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{s.service}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>${s.amount.toFixed(2)}</span>
                          </div>
                          <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(s.amount / maxSvc) * 100}%`, background: i === 0 ? "var(--gradient-4)" : i === 1 ? "var(--gradient-1)" : "var(--gradient-2)", borderRadius: 2 }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI Cost Insight */}
        {showBilling && billing?.aiInsight && (
          <div className="glass-card" style={{ padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 12, border: "1px solid rgba(99,102,241,0.15)" }}>
            <span style={{ fontSize: 20 }}>🤖</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-light)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>AI Cost Insight</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{billing.aiInsight}</div>
            </div>
          </div>
        )}

        {/* Middle Row — Charts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* Donut Chart — Risk Breakdown */}
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Risk Distribution</h3>
            <DonutChart high={high} medium={med} low={low} total={totalRecs} />
          </div>

          {/* Area Chart — Scan Trends */}
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Findings Trend</h3>
            <AreaChart data={trends.length > 0 ? trends : scans.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()).slice(-10).map(s => ({ scanId: s.scanId, startTime: s.startTime, recommendationCount: s.recommendationCount }))} />
          </div>

          {/* Horizontal Bar Chart — By Advisor */}
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>By Advisor</h3>
            <HBarChart data={summary.countsByAdvisor} />
          </div>
        </div>

        {/* Bottom Row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Recent Scans</h3>
              <Link to="/trends" style={{ fontSize: 11, color: "var(--accent-light)" }}>View All →</Link>
            </div>
            {recentScans.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", fontSize: 12, color: "var(--text-muted)" }}>No scans yet</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {recentScans.map((scan, i) => (
                  <div key={scan.scanId} style={{ display: "flex", gap: 14, padding: "12px 0", borderBottom: i < recentScans.length - 1 ? "1px solid var(--border)" : "none", opacity: 0, animation: `fadeInUp 0.4s ease-out ${0.1 + i * 0.08}s forwards` }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20, flexShrink: 0 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: scan.status === "COMPLETED" ? "var(--green)" : scan.status === "FAILED" ? "var(--red)" : "var(--yellow)", boxShadow: `0 0 6px ${scan.status === "COMPLETED" ? "var(--green)" : scan.status === "FAILED" ? "var(--red)" : "var(--yellow)"}`, animation: scan.status === "IN_PROGRESS" ? "pulse 1.5s ease-in-out infinite" : "none" }} />
                      {i < recentScans.length - 1 && <div style={{ width: 1, flex: 1, background: "var(--border)", marginTop: 4 }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{scan.status === "COMPLETED" ? "✅ Completed" : scan.status === "FAILED" ? "❌ Failed" : "⏳ In Progress"}</span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{timeAgo(scan.startTime, timezoneRef.current)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{scan.recommendationCount} finding{scan.recommendationCount !== 1 ? "s" : ""} · {scan.resourcesEvaluated} resources</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Top Findings</h3>
              <Link to="/recommendations" style={{ fontSize: 11, color: "var(--accent-light)" }}>View All →</Link>
            </div>
            {(() => {
              const riskOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
              const topFindings = [...recs]
                .sort((a, b) => (riskOrder[a.riskLevel] ?? 3) - (riskOrder[b.riskLevel] ?? 3) || ((b.estimatedMonthlySavings ?? 0) - (a.estimatedMonthlySavings ?? 0)))
                .slice(0, 5);
              return topFindings.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", fontSize: 12, color: "var(--text-muted)" }}>No findings yet</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {topFindings.map((rec, i) => (
                    <Link key={rec.recommendationId} to={`/recommendations/${rec.recommendationId}`} style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < topFindings.length - 1 ? "1px solid var(--border)" : "none", opacity: 0, animation: `fadeInUp 0.4s ease-out ${0.1 + i * 0.08}s forwards` }}>
                      <span style={{ fontSize: 14, flexShrink: 0 }}>{rec.advisorType === "ZombieResourceDetector" ? "🧟" : rec.advisorType === "PermissionDriftDetector" ? "🔑" : rec.advisorType === "SafeCleanupAdvisor" ? "🧹" : rec.advisorType === "GovernancePolicyEngine" ? "📋" : "⚡"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rec.resourceId}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{formatAdvisor(rec.advisorType)}</div>
                      </div>
                      <span className={`badge ${rec.riskLevel === "High" ? "badge-danger" : rec.riskLevel === "Medium" ? "badge-warning" : "badge-info"}`} style={{ flexShrink: 0 }}>{rec.riskLevel}</span>
                      {rec.estimatedMonthlySavings != null && rec.estimatedMonthlySavings > 0 && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--green)", flexShrink: 0 }}>${rec.estimatedMonthlySavings.toFixed(2)}</span>
                      )}
                    </Link>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Inline keyframes for new animations */}
      <style>{`
        @keyframes wave { 0%,100% { transform: rotate(0deg); } 15% { transform: rotate(14deg); } 30% { transform: rotate(-8deg); } 40% { transform: rotate(14deg); } 50% { transform: rotate(-4deg); } 60% { transform: rotate(10deg); } 70% { transform: rotate(0deg); } }
        @keyframes ringDraw { from { stroke-dasharray: 0 364.4; } }
        @keyframes barGrow { from { width: 0; } to { width: var(--bar-width); } }
        @keyframes numberPop { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes glowPulse { 0%,100% { box-shadow: 0 0 8px var(--glow-color); } 50% { box-shadow: 0 0 20px var(--glow-color); } }
      `}</style>
    </div>
  );
}


function HealthRing({ score, color, label, mounted }: { score: number; color: string; label: string; mounted: boolean }) {
  const animatedScore = useAnimatedNumber(score, 1500);
  const circumference = 364.4;
  const dashLen = (animatedScore / 100) * circumference;
  return (
    <div className="glass-card" style={{ padding: 28, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: mounted ? 1 : 0, transform: mounted ? "scale(1)" : "scale(0.9)", transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s" }}>
      <div style={{ position: "relative", width: 120, height: 120, marginBottom: 12 }}>
        <svg viewBox="0 0 140 140" style={{ transform: "rotate(-90deg)", width: 120, height: 120 }}>
          <circle cx="70" cy="70" r="58" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
          <circle cx="70" cy="70" r="58" fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={`${dashLen} ${circumference}`}
            strokeLinecap="round" style={{ filter: `drop-shadow(0 0 10px ${color})`, transition: "stroke-dasharray 0.05s linear" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1 }}>{animatedScore}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>/ 100</div>
        </div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Cloud Health Score</div>
    </div>
  );
}

function AnimatedStatCard({ icon, label, value, color, desc, prefix, delay, pct }: { icon: string; label: string; value: number; color: string; desc: string; prefix?: string; delay: number; pct?: number }) {
  const animated = useAnimatedNumber(value, 1000);
  const [hovered, setHovered] = useState(false);
  return (
    <div className="glass-card" style={{ padding: "16px 18px", transform: hovered ? "translateY(-3px) scale(1.02)" : "translateY(0) scale(1)", boxShadow: hovered ? "0 8px 24px rgba(0,0,0,0.3)" : "none", transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: pct !== undefined ? 10 : 0 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, transform: hovered ? "scale(1.15) rotate(5deg)" : "scale(1) rotate(0)", transition: "transform 0.3s ease" }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>{prefix || ""}{animated}</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{desc}</span>
          </div>
        </div>
      </div>
      {pct !== undefined && (
        <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(pct, 2)}%`, background: color, borderRadius: 2, transition: "width 1s ease" }} />
        </div>
      )}
    </div>
  );
}

function DonutChart({ high, medium, low, total }: { high: number; medium: number; low: number; total: number }) {
  if (total === 0) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 180 }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" />
        <circle cx="70" cy="70" r="54" fill="none" stroke="var(--green)" strokeWidth="14" strokeDasharray="339.3 339.3" strokeLinecap="round" style={{ transform: "rotate(-90deg)", transformOrigin: "center", filter: "drop-shadow(0 0 6px var(--green))" }} />
      </svg>
      <div style={{ position: "absolute", fontSize: 14, fontWeight: 700, color: "var(--green)" }}>All Clear</div>
    </div>
  );
  const circumference = 2 * Math.PI * 54;
  const highArc = (high / total) * circumference;
  const medArc = (medium / total) * circumference;
  const lowArc = (low / total) * circumference;
  const highOffset = 0;
  const medOffset = highArc;
  const lowOffset = highArc + medArc;
  const segments = [
    { arc: highArc, offset: highOffset, color: "var(--red)", label: "High", count: high },
    { arc: medArc, offset: medOffset, color: "var(--orange)", label: "Medium", count: medium },
    { arc: lowArc, offset: lowOffset, color: "var(--green)", label: "Low", count: low },
  ].filter(s => s.count > 0);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <div style={{ position: "relative", width: 130, height: 130, flexShrink: 0 }}>
        <svg width="130" height="130" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" />
          {segments.map((s, i) => (
            <circle key={i} cx="70" cy="70" r="54" fill="none" stroke={s.color} strokeWidth="14"
              strokeDasharray={`${s.arc} ${circumference - s.arc}`}
              strokeDashoffset={-s.offset}
              style={{ transform: "rotate(-90deg)", transformOrigin: "center", filter: `drop-shadow(0 0 4px ${s.color})`, transition: "all 0.8s ease" }} />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text-primary)" }}>{total}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>total</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{s.count}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpendingChart({ history, currentMonth }: { history: { month: string; amount: number }[]; currentMonth: string }) {
  if (history.length === 0) return <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-muted)" }}>No history</div>;
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const formatMonth = (m: string) => { const [y, mo] = m.split("-"); return `${monthNames[parseInt(mo, 10) - 1]} '${y.slice(2)}`; };
  const w = 400, h = 130, padL = 44, padR = 16, padT = 16, padB = 28;
  const maxVal = Math.max(...history.map(d => d.amount), 1) * 1.15;
  const points = history.map((d, i) => ({
    x: padL + (i / Math.max(history.length - 1, 1)) * (w - padL - padR),
    y: padT + (1 - d.amount / maxVal) * (h - padT - padB),
    val: d.amount, month: d.month,
  }));
  const curvePath = points.map((p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const p0 = points[Math.max(i - 2, 0)];
    const p1 = points[i - 1];
    const p2 = p;
    const p3 = points[Math.min(i + 1, points.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    return `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }).join(" ");
  const areaPath = `${curvePath} L ${points[points.length - 1].x} ${h - padB} L ${points[0].x} ${h - padB} Z`;

  return (
    <svg width="100%" height="130" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <defs>
        <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(6,182,212,0.25)" />
          <stop offset="100%" stopColor="rgba(6,182,212,0)" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
        const y = padT + pct * (h - padT - padB);
        return <line key={i} x1={padL} y1={y} x2={w - padR} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />;
      })}
      {[0, 0.5, 1].map((pct, i) => {
        const y = padT + pct * (h - padT - padB);
        const val = Math.round(maxVal * (1 - pct));
        return <text key={i} x={padL - 6} y={y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="9">${val}</text>;
      })}
      <path d={areaPath} fill="url(#spendGrad)" />
      <path d={curvePath} fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 6px rgba(6,182,212,0.5))" }} />
      {points.map((p, i) => {
        const isCurrent = p.month === currentMonth;
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={isCurrent ? 5 : 3.5} fill={isCurrent ? "var(--cyan)" : "var(--bg-primary)"} stroke="var(--cyan)" strokeWidth="2" />
            {isCurrent && <circle cx={p.x} cy={p.y} r="8" fill="none" stroke="var(--cyan)" strokeWidth="1" opacity="0.3" style={{ animation: "pulse 2s ease-in-out infinite" }} />}
            <text x={p.x} y={p.y - 10} textAnchor="middle" fill="var(--text-primary)" fontSize="9" fontWeight="700">${p.val.toFixed(0)}</text>
          </g>
        );
      })}
      {points.map((p, i) => (
        <text key={i} x={p.x} y={h - 8} textAnchor="middle" fill={p.month === currentMonth ? "var(--cyan)" : "var(--text-muted)"} fontSize="8" fontWeight={p.month === currentMonth ? "700" : "400"}>{formatMonth(p.month)}</text>
      ))}
    </svg>
  );
}

function AreaChart({ data }: { data: { scanId: string; startTime: string; recommendationCount: number }[] }) {
  if (data.length === 0) return <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-muted)" }}>No scan data yet</div>;
  const w = 280, h = 160, pad = 24;
  const maxVal = Math.max(...data.map(d => d.recommendationCount), 1);
  const points = data.map((d, i) => ({
    x: pad + (i / Math.max(data.length - 1, 1)) * (w - pad * 2),
    y: pad + (1 - d.recommendationCount / maxVal) * (h - pad * 2),
    val: d.recommendationCount,
    time: d.startTime,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${h - pad} L ${points[0].x} ${h - pad} Z`;

  return (
    <div style={{ position: "relative" }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(99,102,241,0.3)" />
            <stop offset="100%" stopColor="rgba(99,102,241,0)" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = pad + pct * (h - pad * 2);
          return <line key={i} x1={pad} y1={y} x2={w - pad} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />;
        })}
        {/* Y-axis labels */}
        {[0, 0.5, 1].map((pct, i) => {
          const y = pad + pct * (h - pad * 2);
          const val = Math.round(maxVal * (1 - pct));
          return <text key={i} x={pad - 6} y={y + 3} textAnchor="end" fill="var(--text-muted)" fontSize="9">{val}</text>;
        })}
        {/* Area fill */}
        <path d={areaPath} fill="url(#areaGrad)" />
        {/* Line */}
        <path d={linePath} fill="none" stroke="var(--accent-light)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 4px rgba(99,102,241,0.5))" }} />
        {/* Data points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="var(--bg-primary)" stroke="var(--accent-light)" strokeWidth="2" />
            {i === points.length - 1 && <circle cx={p.x} cy={p.y} r="6" fill="none" stroke="var(--accent-light)" strokeWidth="1" opacity="0.4" style={{ animation: "pulse 2s ease-in-out infinite" }} />}
          </g>
        ))}
        {/* X-axis labels */}
        {points.filter((_, i) => data.length <= 5 || i % Math.ceil(data.length / 5) === 0 || i === data.length - 1).map((p, i) => {
          const d = new Date(p.time);
          const datePart = d.toLocaleDateString("en", { month: "short", day: "numeric" });
          const timePart = d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });
          return (
            <text key={i} x={p.x} y={h - 4} textAnchor="middle" fill="var(--text-muted)" fontSize="7">
              <tspan x={p.x} dy="0">{datePart}</tspan>
              <tspan x={p.x} dy="9">{timePart}</tspan>
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function HBarChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const maxVal = entries.length > 0 ? entries[0][1] : 1;
  if (entries.length === 0) return <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-muted)" }}>No data</div>;
  const colors = ["var(--green)", "var(--purple)", "var(--orange)", "var(--cyan)", "var(--red)"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {entries.map(([name, count], i) => {
        const pct = (count / maxVal) * 100;
        const color = colors[i % colors.length];
        return (
          <div key={name} style={{ opacity: 0, animation: `fadeInUp 0.4s ease-out ${0.1 + i * 0.1}s forwards` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: color, boxShadow: `0 0 6px ${color}` }} />
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{formatAdvisor(name)}</span>
              </div>
              <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>{count}</span>
            </div>
            <div style={{ height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: 0, background: `linear-gradient(90deg, ${color}, ${color}88)`, borderRadius: 4, animation: `barGrow 0.8s ease-out ${0.2 + i * 0.15}s forwards` }} ref={el => { if (el) el.style.setProperty("--bar-width", `${pct}%`); }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadingSkeleton() {
  return <LoadingSpinner message="Fetching details from your account..." />;
}

function formatAdvisor(name: string): string { return name.replace(/([A-Z])/g, " $1").trim(); }
function advisorColor(name: string): string {
  if (name.includes("Cleanup")) return "var(--green)";
  if (name.includes("Permission")) return "var(--purple)";
  if (name.includes("Zombie")) return "var(--orange)";
  return "var(--blue)";
}
function timeAgo(ts: string, tz?: string): string {
  const date = new Date(ts);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const timezone = tz || "UTC";
  const tzLabel = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;
  const formatted = date.toLocaleString("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: true, day: "numeric", month: "short" });
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago (${formatted} ${tzLabel})`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago (${formatted} ${tzLabel})`;
  return `${Math.floor(hrs / 24)}d ago (${formatted} ${tzLabel})`;
}
