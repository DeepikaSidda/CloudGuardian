import { useState, useEffect } from "react";
import { getActions, getRecommendations, controlResource } from "../api-client";
import type { ResourceAction, Recommendation } from "@governance-engine/shared";

const toIST = (s: string) => {
  try { return new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }); } catch { return s; }
};
const AI: Record<string, string> = { stop: "\u23F9\uFE0F", start: "\u25B6\uFE0F", terminate: "\uD83D\uDC80", delete: "\uD83D\uDDD1\uFE0F", release: "\uD83D\uDD13", detach: "\uD83D\uDD17" };
const TS: Record<string, string> = {
  EC2Instance: "EC2 Instances", LambdaFunction: "Lambda Functions", EBSVolume: "EBS Volumes",
  ElasticIP: "Elastic IPs", SecurityGroup: "Security Groups", CloudWatchLogGroup: "CloudWatch Log Groups",
  IAMRole: "IAM Roles", IAMUser: "IAM Users",
};
const sb = (s: string) => s === "SUCCESS" || s === "COMPLETED" ? "badge-low" : s === "FAILED" ? "badge-high" : s === "IN_PROGRESS" ? "badge-info" : "badge-medium";

export default function ActionsPage() {
  const [actions, setActions] = useState<ResourceAction[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exe, setExe] = useState<string | null>(null);
  const [toast, setToast] = useState<{ m: string; ok: boolean } | null>(null);
  const [tab, setTab] = useState<"act" | "hist">("act");
  const [pendingConfirm, setPendingConfirm] = useState<{ rec: Recommendation; act: string } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      getActions().catch(() => [] as ResourceAction[]),
      getRecommendations().catch(() => [] as Recommendation[]),
    ]).then(([a, r]) => {
      setActions([...a].sort((x, y) => new Date(y.initiatedAt).getTime() - new Date(x.initiatedAt).getTime()));
      setRecs(r.filter(x => x.availableActions?.length > 0));
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); } }, [toast]);

  const go = (rec: Recommendation, act: string) => {
    const svc = TS[rec.resourceType];
    if (!svc) { setToast({ m: "Not supported", ok: false }); return; }
    setPendingConfirm({ rec, act });
  };

  const doConfirmedAction = async () => {
    if (!pendingConfirm) return;
    const { rec, act } = pendingConfirm;
    const svc = TS[rec.resourceType];
    setPendingConfirm(null);
    setExe(rec.recommendationId);
    try {
      const r = await controlResource({ service: svc, action: act, resourceId: rec.resourceId, region: rec.region });
      setToast({ m: r.message, ok: r.success });
      if (r.success) load();
    } catch (e: any) { setToast({ m: e.message, ok: false }); } finally { setExe(null); }
  };

  const okC = actions.filter(a => a.status === "SUCCESS" || (a.status as string) === "COMPLETED").length;
  const failC = actions.filter(a => a.status === "FAILED").length;
  const hiR = recs.filter(r => r.riskLevel === "High");

  return (
    <div className="page-enter">
      {toast && <div className={"toast " + (toast.ok ? "toast-success" : "toast-error")} style={{ position: "fixed", top: 20, right: 20, zIndex: 999, animation: "fadeInUp 0.3s ease" }}>{toast.ok ? "\u2705" : "\u274C"} {toast.m}</div>}
      {pendingConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", animation: "fadeIn 0.2s ease" }} onClick={() => setPendingConfirm(null)}>
          <div className="glass-card" style={{ padding: 28, maxWidth: 440, width: "90%", border: "1px solid var(--border-light)", animation: "scaleIn 0.2s ease" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, background: pendingConfirm.act === "delete" || pendingConfirm.act === "terminate" ? "rgba(239,68,68,0.15)" : "rgba(249,115,22,0.15)" }}>
                {pendingConfirm.act === "delete" || pendingConfirm.act === "terminate" ? "\u26A0\uFE0F" : "\uD83D\uDD04"}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Confirm {pendingConfirm.act}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>This action cannot be undone</div>
              </div>
            </div>
            <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Resource</div>
              <code style={{ fontSize: 12, color: "var(--cyan)", wordBreak: "break-all" }}>{pendingConfirm.rec.resourceId}</code>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <span className={"badge badge-" + pendingConfirm.rec.riskLevel.toLowerCase()}>{pendingConfirm.rec.riskLevel}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{pendingConfirm.rec.resourceType} · {pendingConfirm.rec.region}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => setPendingConfirm(null)} style={{ padding: "10px 20px" }}>Cancel</button>
              <button onClick={doConfirmedAction} style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius-md)", cursor: "pointer", border: "none", color: "#fff", background: pendingConfirm.act === "delete" || pendingConfirm.act === "terminate" ? "linear-gradient(135deg, #ef4444, #dc2626)" : "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: pendingConfirm.act === "delete" || pendingConfirm.act === "terminate" ? "0 2px 8px rgba(239,68,68,0.3)" : "0 2px 8px rgba(99,102,241,0.3)" }}>
                {AI[pendingConfirm.act] || "\u26A1"} Yes, {pendingConfirm.act}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>Actions</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Take action on findings and view remediation history</p>
      </div>
      {loading ? (
        <div><div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>{[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 90 }} />)}</div><div className="skeleton" style={{ height: 300 }} /></div>
      ) : error ? <div className="toast toast-error">{"\u26A0\uFE0F"} {error}</div> : (
        <>
          <div className="stagger-children" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
            {[
              { l: "Actionable", v: recs.length, c: recs.length > 0 ? "var(--cyan)" : "var(--text-muted)", d: "findings with actions" },
              { l: "High Risk", v: hiR.length, c: hiR.length > 0 ? "var(--red)" : "var(--green)", d: "need attention" },
              { l: "Executed", v: okC, c: "var(--green)", d: "successful actions" },
              { l: "Failed", v: failC, c: failC > 0 ? "var(--red)" : "var(--text-muted)", d: "failed actions" },
            ].map((k, i) => (
              <div key={i} className="glass-card" style={{ padding: "16px 20px" }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{k.l}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: k.c }}>{k.v}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{k.d}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
            <button onClick={() => setTab("act")} style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "transparent", border: "none", borderBottom: tab === "act" ? "2px solid var(--cyan)" : "2px solid transparent", color: tab === "act" ? "var(--cyan)" : "var(--text-muted)" }}>{"\uD83C\uDFAF"} Actionable ({recs.length})</button>
            <button onClick={() => setTab("hist")} style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "transparent", border: "none", borderBottom: tab === "hist" ? "2px solid var(--cyan)" : "2px solid transparent", color: tab === "hist" ? "var(--cyan)" : "var(--text-muted)" }}>{"\uD83D\uDCCB"} History ({actions.length})</button>
          </div>
          {tab === "act" && (recs.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">{"\u2705"}</div><div className="empty-state-title">No actionable findings</div><div className="empty-state-desc">All findings addressed or have no available actions.</div></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {recs.map((rec, i) => (
                <div key={rec.recommendationId} className="glass-card" style={{ padding: "16px 20px", animation: "fadeInUp 0.3s ease-out " + (i * 0.03) + "s both" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        <span className={"badge badge-" + rec.riskLevel.toLowerCase()}>{rec.riskLevel}</span>
                        <code style={{ fontSize: 11, color: "var(--cyan)", background: "rgba(6,182,212,0.08)", padding: "2px 6px", borderRadius: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280, display: "inline-block" }} title={rec.resourceId}>{rec.resourceId}</code>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{rec.resourceType} {"\u00B7"} {rec.region}</span>
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>{rec.issueDescription}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{"\uD83D\uDCA1"} {rec.suggestedAction}</div>
                      {rec.estimatedMonthlySavings != null && rec.estimatedMonthlySavings > 0 && <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600, marginTop: 4 }}>{"\uD83D\uDCB0"} Save ~${rec.estimatedMonthlySavings.toFixed(2)}/mo</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {rec.availableActions.map(a => (
                        <button key={a} onClick={() => go(rec, a)} disabled={exe === rec.recommendationId}
                          style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "1px solid var(--border)", background: a === "terminate" || a === "delete" ? "rgba(239,68,68,0.1)" : "rgba(6,182,212,0.1)", color: a === "terminate" || a === "delete" ? "var(--red)" : "var(--cyan)", display: "flex", alignItems: "center", gap: 4, opacity: exe === rec.recommendationId ? 0.5 : 1 }}>
                          {exe === rec.recommendationId ? "\u23F3" : (AI[a] || "\u26A1")} {a}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {tab === "hist" && (actions.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">{"\uD83D\uDCCB"}</div><div className="empty-state-title">No action history</div><div className="empty-state-desc">Execute actions to see history here.</div></div>
          ) : (
            <div className="glass-card" style={{ overflow: "hidden" }}>
              <table className="data-table">
                <thead><tr><th>Action</th><th>Resource</th><th>Region</th><th>Status</th><th>Time (IST)</th><th>Result</th></tr></thead>
                <tbody>
                  {actions.map((a, i) => (
                    <tr key={a.actionId || i} style={{ animation: "fadeInUp 0.3s ease-out " + (i * 0.03) + "s both" }}>
                      <td><span style={{ fontWeight: 600 }}>{AI[a.actionType] || "\u26A1"} {a.actionType}</span></td>
                      <td><code style={{ fontSize: 11, color: "var(--cyan)", background: "rgba(6,182,212,0.08)", padding: "2px 6px", borderRadius: 4 }}>{a.resourceId}</code></td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{a.region}</td>
                      <td><span className={"badge " + sb(a.status)}>{a.status}</span></td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{toIST(a.initiatedAt)}</td>
                      <td style={{ fontSize: 11, color: a.status === "FAILED" ? "var(--red)" : "var(--text-muted)", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.result || ""}>{a.result || "\u2014"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
