import { useState, useEffect } from "react";
import { getActiveServices, controlResource, type ServiceCategory, type ServiceResource } from "../api-client";
import LoadingSpinner from "../components/LoadingSpinner";

const REGIONS = ["us-east-1","us-east-2","us-west-1","us-west-2","eu-west-1","eu-west-2","eu-central-1","ap-south-1","ap-southeast-1","ap-northeast-1"];

// Map service names to available actions
const SERVICE_ACTIONS: Record<string, { label: string; action: string; color: string; icon: string; confirm: string }[]> = {
  "EC2 Instances": [
    { label: "Stop", action: "stop", color: "var(--yellow)", icon: "⏸️", confirm: "Stop this EC2 instance? It can be started again later." },
    { label: "Start", action: "start", color: "var(--green)", icon: "▶️", confirm: "Start this EC2 instance?" },
    { label: "Terminate", action: "terminate", color: "var(--red)", icon: "💀", confirm: "PERMANENTLY terminate this EC2 instance? This cannot be undone!" },
  ],
  "Lambda Functions": [
    { label: "Delete", action: "delete", color: "var(--red)", icon: "🗑️", confirm: "Delete this Lambda function? This cannot be undone!" },
  ],
  "S3 Buckets": [
    { label: "Delete", action: "delete", color: "var(--red)", icon: "🗑️", confirm: "Delete this S3 bucket and ALL its contents? This cannot be undone!" },
  ],
  "EBS Volumes": [
    { label: "Delete", action: "delete", color: "var(--red)", icon: "🗑️", confirm: "Delete this EBS volume? This cannot be undone!" },
  ],
  "Elastic IPs": [
    { label: "Release", action: "release", color: "var(--red)", icon: "🔓", confirm: "Release this Elastic IP? You may not get the same IP back." },
  ],
  "Security Groups": [
    { label: "Delete", action: "delete", color: "var(--red)", icon: "🗑️", confirm: "Delete this security group?" },
  ],
  "CloudWatch Log Groups": [
    { label: "Delete", action: "delete", color: "var(--red)", icon: "🗑️", confirm: "Delete this log group and all its logs? This cannot be undone!" },
  ],
  "IAM Roles": [
    { label: "Delete", action: "delete", color: "var(--red)", icon: "🗑️", confirm: "Delete this IAM role? Ensure nothing depends on it." },
  ],
  "IAM Users": [
    { label: "Delete", action: "delete", color: "var(--red)", icon: "🗑️", confirm: "Delete this IAM user? This cannot be undone!" },
  ],
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const cls = s.includes("running") || s.includes("active") || s.includes("available") || s === "in-use"
    ? "badge-low" : s.includes("stopped") || s.includes("error") ? "badge-high" : "badge-info";
  return <span className={`badge ${cls}`}>{status}</span>;
}

interface ConfirmDialog {
  service: string;
  action: string;
  resourceId: string;
  resourceName: string;
  confirmText: string;
}

export default function ActiveServicesPage() {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("us-east-1");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    setLoading(true);
    getActiveServices(selectedRegion)
      .then((data) => { setCategories(data); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedRegion]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const totalResources = categories.reduce((s, c) => s + c.services.reduce((a, svc) => a + svc.count, 0), 0);
  const totalServiceTypes = categories.reduce((s, c) => s + c.services.length, 0);
  const totalCost = categories.reduce((s, c) => s + (c.estimatedMonthlyCost ?? 0), 0);
  const staleResources = categories.flatMap(c => c.services.flatMap(svc => svc.resources.filter(r => r.stale)));
  const staleCost = staleResources.reduce((s, r) => s + (r.estimatedMonthlyCost ?? 0), 0);

  const filtered = searchTerm
    ? categories.map(c => ({ ...c, services: c.services.filter(svc =>
        svc.serviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        svc.resources.some(r => r.name.toLowerCase().includes(searchTerm.toLowerCase()))
      ) })).filter(c => c.services.length > 0)
    : categories;

  const handleExportCSV = () => {
    const rows = ["Category,Service,Resource Name,Resource ID,Status,Details,Est. Cost"];
    for (const cat of categories) {
      for (const svc of cat.services) {
        for (const r of svc.resources) {
          rows.push(`"${cat.category}","${svc.serviceName}","${r.name}","${r.id}","${r.status ?? ""}","${(r.details ?? "").replace(/"/g, '""')}","${r.estimatedMonthlyCost ?? 0}"`);
        }
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `cloudguardian-inventory-${selectedRegion}-${new Date().toISOString().split("T")[0]}.csv`; a.click();
  };

  const handleAction = (service: string, actionDef: typeof SERVICE_ACTIONS[""][0], resource: ServiceResource) => {
    setConfirmDialog({
      service,
      action: actionDef.action,
      resourceId: resource.id,
      resourceName: resource.name || resource.id,
      confirmText: actionDef.confirm,
    });
  };

  const executeAction = async () => {
    if (!confirmDialog) return;
    const key = `${confirmDialog.resourceId}-${confirmDialog.action}`;
    setActionLoading(key);
    setConfirmDialog(null);
    try {
      const result = await controlResource({
        service: confirmDialog.service,
        action: confirmDialog.action,
        resourceId: confirmDialog.resourceId,
        region: selectedRegion,
      });
      if (result.success) {
        setToast({ message: `✅ ${result.message}`, type: "success" });
        // Refresh data after action
        setTimeout(() => {
          getActiveServices(selectedRegion).then(d => setCategories(d)).catch(() => {});
        }, 2000);
      } else {
        setToast({ message: `❌ ${result.message}`, type: "error" });
      }
    } catch (err: any) {
      setToast({ message: `❌ ${err.message ?? "Action failed"}`, type: "error" });
    } finally {
      setActionLoading(null);
    }
  };

  const getVisibleActions = (serviceName: string, resource: ServiceResource) => {
    const actions = SERVICE_ACTIONS[serviceName];
    if (!actions) return [];
    // Filter actions based on resource status
    const status = (resource.status ?? "").toLowerCase();
    return actions.filter(a => {
      if (serviceName === "EC2 Instances") {
        if (a.action === "stop" && (status === "stopped" || status === "terminated")) return false;
        if (a.action === "start" && (status === "running" || status === "terminated")) return false;
        if (a.action === "terminate" && status === "terminated") return false;
      }
      if (serviceName === "Elastic IPs" && a.action === "release" && status === "associated") return false;
      return true;
    });
  };

  if (loading) return <LoadingSpinner message="Discovering active services in your account..." />;

  if (error) return (
    <div className="page-enter">
      <div className="toast toast-error">Error: {error}</div>
      <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => { setError(null); setLoading(true); getActiveServices(selectedRegion).then(d => { setCategories(d); setError(null); }).catch(e => setError(e.message)).finally(() => setLoading(false)); }}>Retry</button>
    </div>
  );

  return (
    <div className="page-enter">
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999, padding: "14px 24px",
          borderRadius: 12, fontSize: 13, fontWeight: 600, maxWidth: 400,
          background: toast.type === "success" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          border: `1px solid ${toast.type === "success" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
          color: toast.type === "success" ? "var(--green)" : "var(--red)",
          backdropFilter: "blur(12px)", animation: "fadeInUp 0.3s ease-out",
        }}>
          {toast.message}
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", animation: "fadeInUp 0.2s ease-out",
        }} onClick={() => setConfirmDialog(null)}>
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16,
            padding: "28px 32px", maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: "var(--red)" }}>⚠️ Confirm Action</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
              Resource: <span style={{ color: "var(--cyan)", fontWeight: 600 }}>{confirmDialog.resourceName}</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
              {confirmDialog.confirmText}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => setConfirmDialog(null)} style={{ fontSize: 13 }}>Cancel</button>
              <button onClick={executeAction} style={{
                padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
                background: "linear-gradient(135deg, var(--red), #dc2626)", color: "#fff",
              }}>
                {confirmDialog.action.charAt(0).toUpperCase() + confirmDialog.action.slice(1)}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>Active Services</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Live inventory with real-time cost tracking and resource control</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select className="form-select" style={{ width: 160 }} value={selectedRegion} onChange={e => setSelectedRegion(e.target.value)}>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input className="form-input" style={{ width: 200 }} placeholder="Search services..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          <button className="btn-secondary" onClick={handleExportCSV}>Export CSV</button>
        </div>
      </div>

      <div className="stagger-children" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
        <div className="glass-card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="stat-icon" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.1))" }}>🔌</div>
            <div><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Service Types</div><div style={{ fontSize: 24, fontWeight: 800 }}>{totalServiceTypes}</div></div>
          </div>
        </div>
        <div className="glass-card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="stat-icon" style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(59,130,246,0.1))" }}>📦</div>
            <div><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Total Resources</div><div style={{ fontSize: 24, fontWeight: 800 }}>{totalResources}</div></div>
          </div>
        </div>
        <div className="glass-card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="stat-icon" style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.2), rgba(6,182,212,0.1))" }}>💰</div>
            <div><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Accrued Cost</div><div style={{ fontSize: 24, fontWeight: 800 }}>${totalCost.toFixed(2)}</div></div>
          </div>
        </div>
        <div className="glass-card" style={{ padding: "20px 24px", border: staleResources.length > 0 ? "1px solid rgba(249,115,22,0.3)" : undefined }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="stat-icon" style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.2), rgba(239,68,68,0.1))" }}>⚠️</div>
            <div><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Stale (6+ months)</div><div style={{ fontSize: 24, fontWeight: 800, color: staleResources.length > 0 ? "#f97316" : "var(--text-primary)" }}>{staleResources.length}</div></div>
          </div>
        </div>
      </div>

      {staleResources.length > 0 && (
        <div style={{
          padding: "16px 24px", marginBottom: 24, borderRadius: 12,
          background: "linear-gradient(135deg, rgba(249,115,22,0.08), rgba(239,68,68,0.05))",
          border: "1px solid rgba(249,115,22,0.2)",
          display: "flex", alignItems: "center", gap: 16,
        }}>
          <span style={{ fontSize: 28 }}>🧹</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f97316", marginBottom: 4 }}>
              {staleResources.length} resource{staleResources.length !== 1 ? "s" : ""} inactive for 6+ months
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              These resources haven't been active for over 6 months. If you no longer need them, consider removing them to save
              {staleCost > 0 ? ` ~$${staleCost.toFixed(2)}` : ""} and keep your cloud clean.
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-state-icon">🔍</div><div className="empty-state-title">No services found</div><div className="empty-state-desc">No active services match your search in {selectedRegion}.</div></div>
      ) : (
        <div className="stagger-children" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {filtered.map(cat => (
            <div key={cat.category} className="glass-card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 20 }}>{cat.icon}</span>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{cat.category}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{cat.services.length} service{cat.services.length !== 1 ? "s" : ""}</div>
                  </div>
                </div>
                {(cat.estimatedMonthlyCost ?? 0) > 0 && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--green)" }}>${(cat.estimatedMonthlyCost ?? 0).toFixed(2)}</span>
                )}
              </div>
              <div>
                {cat.services.map(svc => {
                  const key = `${cat.category}-${svc.serviceName}`;
                  const isExpanded = expandedService === key;
                  const hasActions = !!SERVICE_ACTIONS[svc.serviceName];
                  return (
                    <div key={key}>
                      <div onClick={() => setExpandedService(isExpanded ? null : key)}
                        style={{ padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", borderBottom: "1px solid var(--border)", transition: "background var(--transition-fast)" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ fontSize: 16 }}>{svc.icon}</span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{svc.serviceName}</span>
                          <span className="badge badge-info">{svc.count}</span>
                          {hasActions && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(239,68,68,0.1)", color: "var(--red)", fontWeight: 600 }}>ACTIONS</span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          {(svc.estimatedMonthlyCost ?? 0) > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--green)" }}>${(svc.estimatedMonthlyCost ?? 0).toFixed(2)}</span>}
                          {(svc.estimatedMonthlyCost ?? 0) === 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Free</span>}
                          <span style={{ fontSize: 12, color: "var(--text-muted)", transition: "transform var(--transition-fast)", transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
                        </div>
                      </div>
                      {isExpanded && svc.resources.length > 0 && (
                        <div style={{ padding: "0 24px 12px", animation: "fadeInUp 0.2s ease-out" }}>
                          <table className="data-table" style={{ marginTop: 8 }}>
                            <thead><tr><th>Name</th><th>ID</th><th>Status</th><th>Details / Pricing</th><th>Accrued Cost</th>{hasActions && <th style={{ textAlign: "center" }}>Actions</th>}</tr></thead>
                            <tbody>
                              {svc.resources.map((r, i) => {
                                const visibleActions = getVisibleActions(svc.serviceName, r);
                                const isActioning = actionLoading === `${r.id}-${visibleActions[0]?.action}`;
                                return (
                                  <tr key={i} style={r.stale ? { background: "rgba(249,115,22,0.04)" } : undefined}>
                                    <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                                      {r.name}
                                      {r.stale && (
                                        <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(249,115,22,0.12)", color: "#f97316", fontWeight: 700 }} title={`Created ${r.staleDays} days ago. Consider removing if unused.`}>
                                          ⚠️ {r.staleDays! > 365 ? `${Math.floor(r.staleDays! / 365)}y ${Math.floor((r.staleDays! % 365) / 30)}m old` : `${Math.floor(r.staleDays! / 30)}m old`}
                                        </span>
                                      )}
                                    </td>
                                    <td><code style={{ fontSize: 11, color: "var(--cyan)", background: "rgba(6,182,212,0.08)", padding: "2px 6px", borderRadius: 4 }}>{r.id}</code></td>
                                    <td><StatusBadge status={r.status} /></td>
                                    <td style={{ maxWidth: 300, fontSize: 12, color: "var(--text-secondary)" }} title={r.details ?? ""}>{r.details || "-"}</td>
                                    <td style={{ fontWeight: 600, color: (r.estimatedMonthlyCost ?? 0) > 0 ? "var(--green)" : "var(--text-muted)", whiteSpace: "nowrap" }}>
                                      {(r.estimatedMonthlyCost ?? 0) > 0 ? `$${r.estimatedMonthlyCost!.toFixed(2)}` : "Free"}
                                    </td>
                                    {hasActions && (
                                      <td style={{ textAlign: "center" }}>
                                        <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                                          {visibleActions.map(actionDef => {
                                            const loadKey = `${r.id}-${actionDef.action}`;
                                            const isLoading = actionLoading === loadKey;
                                            return (
                                              <button key={actionDef.action} onClick={(e) => { e.stopPropagation(); handleAction(svc.serviceName, actionDef, r); }}
                                                disabled={isLoading}
                                                style={{
                                                  padding: "4px 10px", borderRadius: 6, border: `1px solid ${actionDef.color}33`,
                                                  background: `${actionDef.color}15`, color: actionDef.color,
                                                  fontSize: 11, fontWeight: 700, cursor: isLoading ? "wait" : "pointer",
                                                  opacity: isLoading ? 0.5 : 1, transition: "all 0.15s ease",
                                                  display: "flex", alignItems: "center", gap: 4,
                                                }}
                                                onMouseEnter={e => { if (!isLoading) { e.currentTarget.style.background = `${actionDef.color}30`; e.currentTarget.style.transform = "scale(1.05)"; } }}
                                                onMouseLeave={e => { e.currentTarget.style.background = `${actionDef.color}15`; e.currentTarget.style.transform = "scale(1)"; }}
                                              >
                                                <span>{actionDef.icon}</span>
                                                {isLoading ? "..." : actionDef.label}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
