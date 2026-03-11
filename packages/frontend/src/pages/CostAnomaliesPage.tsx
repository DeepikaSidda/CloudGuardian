import { useState, useEffect } from "react";
import { getCostAnomalies, type CostAnomalyResponse } from "../api-client";
import LoadingSpinner from "../components/LoadingSpinner";

const RISK_COLORS: Record<string, string> = { High: "var(--red)", Medium: "var(--orange)", Low: "var(--yellow)" };
const ADVISOR_LABELS: Record<string, string> = {
  SafeCleanupAdvisor: "Safe Cleanup",
  PermissionDriftDetector: "Permission Drift",
  ZombieResourceDetector: "Zombie Resources",
};
const ADVISOR_ICONS: Record<string, string> = {
  SafeCleanupAdvisor: "🧹",
  PermissionDriftDetector: "🔐",
  ZombieResourceDetector: "🧟",
};

const toIST = (s: string) => { try { return new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }); } catch { return s; } };

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ width: "100%", height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.6s ease" }} />
    </div>
  );
}

function DeltaBadge({ value, suffix }: { value: number; suffix?: string }) {
  if (value === 0) return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>;
  const isUp = value > 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: isUp ? "var(--red)" : "var(--green)", display: "inline-flex", alignItems: "center", gap: 2 }}>
      {isUp ? "▲" : "▼"} {isUp ? "+" : ""}{value}{suffix ?? ""}
    </span>
  );
}

export default function CostAnomaliesPage() {
  const [data, setData] = useState<CostAnomalyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "anomalies" | "breakdown" | "new" | "resolved">("overview");

  useEffect(() => {
    setLoading(true);
    getCostAnomalies()
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner message="Analyzing cost anomalies..." />;
  if (error) return <div className="page-enter"><div className="toast toast-error">⚠️ {error}</div></div>;
  if (!data) return null;

  const recDelta = data.totalLatest - data.totalPrevious;
  const savings = data.savingsComparison;
  const newCount = data.newResources?.length ?? 0;
  const resolvedCount = data.resolvedResources?.length ?? 0;
  const highRiskLatest = data.riskComparison?.latest?.High ?? 0;
  const highRiskPrev = data.riskComparison?.previous?.High ?? 0;

  if (data.message) {
    return (
      <div className="page-enter">
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>Cost & Drift Intelligence</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Cross-scan analysis, anomaly detection, and savings tracking</p>
        </div>
        <div className="empty-state"><div className="empty-state-icon">📊</div><div className="empty-state-title">{data.message}</div><div className="empty-state-desc">Run at least 2 scans to enable anomaly detection and drift analysis.</div></div>
      </div>
    );
  }

  const tabs = [
    { id: "overview" as const, label: "Overview", icon: "📊" },
    { id: "anomalies" as const, label: `Anomalies (${data.anomalies.length})`, icon: "🚨" },
    { id: "breakdown" as const, label: "Resource Breakdown", icon: "📋" },
    { id: "new" as const, label: `New Issues (${newCount})`, icon: "🆕" },
    { id: "resolved" as const, label: `Dropped Off (${resolvedCount})`, icon: "✅" },
  ];

  return (
    <div className="page-enter">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>Cost & Drift Intelligence</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Cross-scan analysis, anomaly detection, and savings tracking</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right" }}>
            <div>Previous: {toIST(data.previousTime)}</div>
            <div>Latest: {toIST(data.latestTime)}</div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stagger-children" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 24 }}>
        <div className="glass-card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Total Findings</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 26, fontWeight: 800 }}>{data.totalLatest}</span>
            <DeltaBadge value={recDelta} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>vs {data.totalPrevious} previous</div>
        </div>
        <div className="glass-card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>High Risk</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: highRiskLatest > 0 ? "var(--red)" : "var(--green)" }}>{highRiskLatest}</span>
            <DeltaBadge value={highRiskLatest - highRiskPrev} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>critical findings</div>
        </div>
        <div className="glass-card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Est. Savings</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: "var(--green)" }}>${(savings?.latest ?? 0).toFixed(0)}</span>
            <DeltaBadge value={savings?.delta ?? 0} suffix="/mo" />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>monthly potential</div>
        </div>
        <div className="glass-card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>New Issues</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: newCount > 0 ? "var(--orange)" : "var(--green)" }}>{newCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>since last scan</div>
        </div>
        <div className="glass-card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>No Longer Flagged</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--green)" }}>{resolvedCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>dropped off since last scan</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "10px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: "transparent", border: "none", borderBottom: activeTab === tab.id ? "2px solid var(--cyan)" : "2px solid transparent",
              color: activeTab === tab.id ? "var(--cyan)" : "var(--text-muted)",
              transition: "all 0.15s ease", display: "flex", alignItems: "center", gap: 6,
            }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="stagger-children" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Risk Level Distribution — Simple Cards */}
          <div className="glass-card" style={{ padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>🎯 Risk Level Distribution</div>
            <div style={{ display: "flex", gap: 12 }}>
              {["High", "Medium", "Low"].map(level => {
                const curr = data.riskComparison?.latest?.[level] ?? 0;
                const prev = data.riskComparison?.previous?.[level] ?? 0;
                return (
                  <div key={level} style={{
                    flex: 1, padding: "14px 12px", borderRadius: 10,
                    background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: RISK_COLORS[level], marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>{level}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: curr > 0 ? RISK_COLORS[level] : "var(--text-muted)", lineHeight: 1 }}>{curr}</div>
                    <div style={{ marginTop: 6 }}><DeltaBadge value={curr - prev} /></div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>was {prev}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Advisor Breakdown — Simple Cards */}
          <div className="glass-card" style={{ padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>🔍 Advisor Breakdown</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(ADVISOR_LABELS).map(([key, label]) => {
                const curr = data.advisorComparison?.latest?.[key] ?? 0;
                const prev = data.advisorComparison?.previous?.[key] ?? 0;
                return (
                  <div key={key} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 14px", borderRadius: 10,
                    background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{ADVISOR_ICONS[key]} {label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 22, fontWeight: 800 }}>{curr}</span>
                      <DeltaBadge value={curr - prev} />
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>was {prev}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Cost-Impacting Resources */}
          {(data.topCostResources?.length ?? 0) > 0 && (
            <div className="glass-card" style={{ padding: "20px 24px", gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>💰 Top Cost-Saving Opportunities</div>
              <table className="data-table">
                <thead><tr><th>Resource</th><th>Type</th><th>Advisor</th><th>Risk</th><th>Region</th><th style={{ textAlign: "right" }}>Est. Savings/mo</th></tr></thead>
                <tbody>
                  {data.topCostResources!.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.resourceId}>{r.resourceId}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{r.issueDescription}</div>
                      </td>
                      <td><code style={{ fontSize: 11, color: "var(--cyan)", background: "rgba(6,182,212,0.08)", padding: "2px 6px", borderRadius: 4 }}>{r.resourceType}</code></td>
                      <td style={{ fontSize: 11 }}>{ADVISOR_ICONS[r.advisorType ?? ""] ?? "📋"} {ADVISOR_LABELS[r.advisorType ?? ""] ?? r.advisorType}</td>
                      <td><span className={`badge badge-${r.riskLevel.toLowerCase()}`}>{r.riskLevel}</span></td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.region}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--green)", fontSize: 13 }}>${(r.estimatedMonthlySavings ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Anomalies Tab */}
      {activeTab === "anomalies" && (
        <div>
          {data.anomalies.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">✅</div><div className="empty-state-title">No Anomalies Detected</div><div className="empty-state-desc">Resource counts are stable between scans. No unusual spikes or drops.</div></div>
          ) : (
            <div className="glass-card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>🚨 Detected Anomalies</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Threshold: ≥3 count change or ≥50% relative change</div>
              </div>
              <table className="data-table">
                <thead><tr><th>Resource Type</th><th style={{ textAlign: "center" }}>Previous</th><th style={{ textAlign: "center" }}>Current</th><th style={{ textAlign: "center" }}>Change</th><th style={{ textAlign: "center" }}>% Change</th><th>Severity</th><th>Impact</th></tr></thead>
                <tbody>
                  {data.anomalies.map((a, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.resourceType}</td>
                      <td style={{ textAlign: "center" }}>{a.previousCount}</td>
                      <td style={{ textAlign: "center", fontWeight: 600 }}>{a.currentCount}</td>
                      <td style={{ textAlign: "center" }}><DeltaBadge value={a.change} /></td>
                      <td style={{ textAlign: "center" }}><DeltaBadge value={a.percentChange} suffix="%" /></td>
                      <td><span className={`badge badge-${a.severity.toLowerCase()}`}>{a.severity}</span></td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {a.change > 0 ? "⚠️ Resource count increased — potential cost spike" : "📉 Resource count decreased — possible cleanup"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Resource Breakdown Tab */}
      {activeTab === "breakdown" && (
        <div className="glass-card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>📋 Full Resource Type Breakdown</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Complete comparison of all resource types between scans with cost impact</div>
          </div>
          <table className="data-table">
            <thead><tr><th>Resource Type</th><th style={{ textAlign: "center" }}>Previous</th><th style={{ textAlign: "center" }}>Current</th><th style={{ textAlign: "center" }}>Δ Count</th><th style={{ textAlign: "right" }}>Prev Savings</th><th style={{ textAlign: "right" }}>Curr Savings</th><th style={{ textAlign: "right" }}>Δ Savings</th></tr></thead>
            <tbody>
              {(data.resourceBreakdown ?? []).map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.resourceType}</td>
                  <td style={{ textAlign: "center" }}>{r.previous}</td>
                  <td style={{ textAlign: "center", fontWeight: 600 }}>{r.current}</td>
                  <td style={{ textAlign: "center" }}><DeltaBadge value={r.change} /></td>
                  <td style={{ textAlign: "right", fontSize: 12, color: "var(--text-muted)" }}>{r.costPrev > 0 ? `$${r.costPrev.toFixed(2)}` : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 12, fontWeight: 600, color: r.costCurr > 0 ? "var(--green)" : "var(--text-muted)" }}>{r.costCurr > 0 ? `$${r.costCurr.toFixed(2)}` : "—"}</td>
                  <td style={{ textAlign: "right" }}>{(r.costCurr - r.costPrev) !== 0 ? <DeltaBadge value={Math.round((r.costCurr - r.costPrev) * 100) / 100} suffix="" /> : <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Issues Tab */}
      {activeTab === "new" && (
        <div>
          {newCount === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">🎉</div><div className="empty-state-title">No New Issues</div><div className="empty-state-desc">No new resources flagged since the previous scan.</div></div>
          ) : (
            <div className="glass-card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>🆕 Newly Detected Issues</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Resources flagged in the latest scan that were not present in the previous scan</div>
              </div>
              <table className="data-table">
                <thead><tr><th>Resource ID</th><th>Type</th><th>Risk</th><th>Issue</th><th style={{ textAlign: "right" }}>Est. Savings</th></tr></thead>
                <tbody>
                  {data.newResources!.map((r, i) => (
                    <tr key={i}>
                      <td><code style={{ fontSize: 11, color: "var(--cyan)", background: "rgba(6,182,212,0.08)", padding: "2px 6px", borderRadius: 4 }}>{r.resourceId}</code></td>
                      <td style={{ fontSize: 12 }}>{r.resourceType}</td>
                      <td><span className={`badge badge-${r.riskLevel.toLowerCase()}`}>{r.riskLevel}</span></td>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)", maxWidth: 300 }}>{r.issueDescription}</td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: (r.estimatedMonthlySavings ?? 0) > 0 ? "var(--green)" : "var(--text-muted)" }}>
                        {(r.estimatedMonthlySavings ?? 0) > 0 ? `$${r.estimatedMonthlySavings!.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Resolved Tab */}
      {activeTab === "resolved" && (
        <div>
          {resolvedCount === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-title">No Resolved Issues</div><div className="empty-state-desc">No previously flagged resources were resolved between scans.</div></div>
          ) : (
            <div className="glass-card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>✅ No Longer Flagged</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Resources flagged in the previous scan but absent from the latest — may have been cleaned up, terminated, or excluded from scan scope</div>
              </div>
              <table className="data-table">
                <thead><tr><th>Resource ID</th><th>Type</th><th>Risk</th><th>Issue (was)</th><th style={{ textAlign: "right" }}>Was Costing</th></tr></thead>
                <tbody>
                  {data.resolvedResources!.map((r, i) => (
                    <tr key={i}>
                      <td><code style={{ fontSize: 11, color: "var(--green)", background: "rgba(34,197,94,0.08)", padding: "2px 6px", borderRadius: 4 }}>{r.resourceId}</code></td>
                      <td style={{ fontSize: 12 }}>{r.resourceType}</td>
                      <td><span className={`badge badge-${r.riskLevel.toLowerCase()}`}>{r.riskLevel}</span></td>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)", maxWidth: 300 }}>{r.issueDescription}</td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: (r.estimatedMonthlySavings ?? 0) > 0 ? "var(--green)" : "var(--text-muted)" }}>
                        {(r.estimatedMonthlySavings ?? 0) > 0 ? `$${r.estimatedMonthlySavings!.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
