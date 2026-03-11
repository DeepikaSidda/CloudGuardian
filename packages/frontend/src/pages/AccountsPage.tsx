import { useState, useEffect } from "react";
import { getSummary, getScans, getSetting, putSetting, type DashboardSummary } from "../api-client";
import type { ScanRecord } from "@governance-engine/shared";
import LoadingSpinner from "../components/LoadingSpinner";

export default function AccountsPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ accountId: "", alias: "", roleArn: "" });
  const [savedAccounts, setSavedAccounts] = useState<{ accountId: string; alias: string; roleArn: string }[]>([]);

  useEffect(() => {
    Promise.all([getSummary(), getScans(), getSetting<{ accountId: string; alias: string; roleArn: string }[]>("extra_accounts")])
      .then(([s, sc, settingRes]) => {
        setSummary(s);
        setScans(sc);
        // Migrate localStorage to DynamoDB if needed
        const localAccounts = (() => { try { return JSON.parse(localStorage.getItem("cg_extra_accounts") || "[]"); } catch { return []; } })();
        if (settingRes.value && Array.isArray(settingRes.value)) {
          setSavedAccounts(settingRes.value);
          if (localAccounts.length > 0) { localStorage.removeItem("cg_extra_accounts"); }
        } else if (localAccounts.length > 0) {
          setSavedAccounts(localAccounts);
          putSetting("extra_accounts", localAccounts).then(() => localStorage.removeItem("cg_extra_accounts")).catch(() => {});
        }
        setError(null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const accounts = summary?.perAccount ? Object.entries(summary.perAccount) : [];
  const acctInfo = summary?.accountInfo;
  const lastScan = [...scans].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
  const totalFindings = accounts.reduce((s, [, d]: [string, any]) => s + (d.recommendationCount ?? d.count ?? 0), 0);
  const totalSavings = accounts.reduce((s, [, d]: [string, any]) => s + (d.costSavings ?? d.savings ?? 0), 0);

  const handleAddAccount = () => {
    if (!addForm.accountId.match(/^\d{12}$/)) return;
    const updated = [...savedAccounts, { ...addForm }];
    setSavedAccounts(updated);
    putSetting("extra_accounts", updated).catch(() => {});
    setAddForm({ accountId: "", alias: "", roleArn: "" });
    setShowAddModal(false);
  };

  const handleRemoveAccount = (id: string) => {
    const updated = savedAccounts.filter(a => a.accountId !== id);
    setSavedAccounts(updated);
    putSetting("extra_accounts", updated).catch(() => {});
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
  };

  if (loading) return <LoadingSpinner message="Fetching account details..." />;

  if (error) return <div className="page-enter"><div className="toast toast-error">⚠️ {error}</div></div>;

  return (
    <div className="page-enter">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Accounts</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Manage and monitor your AWS accounts</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ Add Account</button>
      </div>

      {/* Summary Stats */}
      <div className="stagger-children" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        <div className="glass-card" style={{ padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.1))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🏢</div>
            <div><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Active Accounts</div><div style={{ fontSize: 22, fontWeight: 800 }}>{accounts.length + savedAccounts.length}</div></div>
          </div>
        </div>
        <div className="glass-card" style={{ padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, rgba(239,68,68,0.2), rgba(249,115,22,0.1))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>💡</div>
            <div><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Total Findings</div><div style={{ fontSize: 22, fontWeight: 800 }}>{totalFindings}</div></div>
          </div>
        </div>
        <div className="glass-card" style={{ padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, rgba(34,197,94,0.2), rgba(6,182,212,0.1))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>💰</div>
            <div><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Total Savings</div><div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)" }}>${totalSavings.toFixed(2)}</div></div>
          </div>
        </div>
        <div className="glass-card" style={{ padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(59,130,246,0.1))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🔍</div>
            <div><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Last Scan</div><div style={{ fontSize: 13, fontWeight: 600 }}>{lastScan ? formatTime(lastScan.startTime) : "Never"}</div></div>
          </div>
        </div>
      </div>

      {/* Primary Account (from API) */}
      {accounts.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 14 }}>Connected Accounts</div>
          <div className="stagger-children" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {accounts.map(([acctId, data]: [string, any]) => {
              const isMain = acctId === acctInfo?.accountId || acctId === "self";
              const displayId = isMain && acctInfo ? acctInfo.accountId : acctId;
              const displayName = isMain && acctInfo && acctInfo.accountName !== acctInfo.accountId ? acctInfo.accountName : null;
              return (
                <div key={acctId} className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "stretch" }}>
                    {/* Left accent */}
                    <div style={{ width: 4, background: isMain ? "var(--gradient-1)" : "var(--gradient-2)", flexShrink: 0 }} />
                    <div style={{ flex: 1, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <div style={{ width: 48, height: 48, borderRadius: 14, background: isMain ? "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.08))" : "linear-gradient(135deg, rgba(6,182,212,0.15), rgba(59,130,246,0.08))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                          {isMain ? "🛡️" : "🏢"}
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{displayName || "AWS Account"}</span>
                            {isMain && <span className="badge badge-info" style={{ fontSize: 10 }}>Primary</span>}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <code style={{ fontSize: 12, color: "var(--cyan)", background: "rgba(6,182,212,0.08)", padding: "2px 8px", borderRadius: 4 }}>{displayId}</code>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>us-east-1</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Findings</div>
                          <div style={{ fontSize: 22, fontWeight: 800 }}>{data.recommendationCount ?? data.count ?? 0}</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Savings</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)" }}>${(data.costSavings ?? data.savings ?? 0).toFixed(2)}</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Status</div>
                          <span className="badge badge-low">● Connected</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Saved / Additional Accounts */}
      {savedAccounts.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 14 }}>Additional Accounts</div>
          <div className="stagger-children" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {savedAccounts.map(acct => (
              <div key={acct.accountId} className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "stretch" }}>
                  <div style={{ width: 4, background: "var(--gradient-3)", flexShrink: 0 }} />
                  <div style={{ flex: 1, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(6,182,212,0.08))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏢</div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2 }}>{acct.alias || "AWS Account"}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <code style={{ fontSize: 12, color: "var(--cyan)", background: "rgba(6,182,212,0.08)", padding: "2px 8px", borderRadius: 4 }}>{acct.accountId}</code>
                          {acct.roleArn && <span style={{ fontSize: 11, color: "var(--text-muted)" }} title={acct.roleArn}>Cross-account role</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Status</div>
                        <span className="badge badge-medium">● Pending Scan</span>
                      </div>
                      <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: 11 }} onClick={() => handleRemoveAccount(acct.accountId)}>Remove</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state if no accounts at all */}
      {accounts.length === 0 && savedAccounts.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🏢</div>
          <div className="empty-state-title">No accounts configured</div>
          <div className="empty-state-desc">Run a scan or add an account to get started.</div>
        </div>
      )}

      {/* How it works section */}
      <div className="glass-card" style={{ padding: 24, marginTop: 8 }}>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>How Cross-Account Access Works</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(99,102,241,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>1</div>
            <div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>Create IAM Role</div><div style={{ fontSize: 12, color: "var(--text-muted)" }}>Create a read-only role in the target account with trust policy for this account.</div></div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(6,182,212,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>2</div>
            <div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>Add Account</div><div style={{ fontSize: 12, color: "var(--text-muted)" }}>Enter the account ID and the cross-account role ARN above.</div></div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(34,197,94,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>3</div>
            <div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>Run Scan</div><div style={{ fontSize: 12, color: "var(--text-muted)" }}>CloudGuardian will assume the role and scan resources in that account.</div></div>
          </div>
        </div>
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, animation: "fadeIn 0.2s ease-out" }} onClick={() => setShowAddModal(false)}>
          <div className="glass-card" style={{ width: 460, padding: 0, overflow: "hidden", animation: "scaleIn 0.25s ease-out" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Add AWS Account</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Connect another account for cross-account scanning</div>
              </div>
              <button onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer", padding: 4 }}>✕</button>
            </div>
            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>Account ID *</label>
                <input className="form-input" placeholder="123456789012" value={addForm.accountId} onChange={e => setAddForm({ ...addForm, accountId: e.target.value.replace(/\D/g, "").slice(0, 12) })} />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>12-digit AWS account number</div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>Account Alias</label>
                <input className="form-input" placeholder="e.g. Production, Staging" value={addForm.alias} onChange={e => setAddForm({ ...addForm, alias: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>Cross-Account Role ARN</label>
                <input className="form-input" placeholder="arn:aws:iam::123456789012:role/GovernanceReadOnly" value={addForm.roleArn} onChange={e => setAddForm({ ...addForm, roleArn: e.target.value })} />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>IAM role ARN that CloudGuardian can assume</div>
              </div>
            </div>
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddAccount} disabled={addForm.accountId.length !== 12}>Add Account</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
