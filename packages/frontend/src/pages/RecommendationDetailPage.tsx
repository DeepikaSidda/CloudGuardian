import React, { useState, useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { getRecommendation, initiateAction, getAIRecommendation, getDependencySubgraph } from "../api-client";
import MiniDependencyGraph from "../components/MiniDependencyGraph";
import { calculateBlastRadius } from "../utils/blast-radius";
import type { Recommendation, BlastRadiusResult } from "@governance-engine/shared";
import LoadingSpinner from "../components/LoadingSpinner";

/** Simple markdown to HTML renderer for AI analysis text */
function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML entities
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks: ```lang\n...\n```
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, (_m, code) =>
    `<pre style="background:rgba(0,0,0,0.3);padding:12px 16px;border-radius:8px;overflow-x:auto;font-size:12px;color:#e2e8f0;margin:8px 0;border:1px solid rgba(255,255,255,0.06)"><code>${code.trim()}</code></pre>`
  );

  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g,
    '<code style="background:rgba(6,182,212,0.1);color:var(--cyan);padding:1px 5px;border-radius:4px;font-size:12px">$1</code>'
  );

  // Headers: # ... , ## ... and ### ...
  html = html.replace(/^### (.+)$/gm,
    '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin:14px 0 6px">$1</div>'
  );
  html = html.replace(/^## (.+)$/gm,
    '<div style="font-size:14px;font-weight:700;color:var(--text-primary);margin:16px 0 8px">$1</div>'
  );
  html = html.replace(/^# (.+)$/gm,
    '<div style="font-size:15px;font-weight:800;color:var(--text-primary);margin:18px 0 10px">$1</div>'
  );

  // Bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-primary);font-weight:600">$1</strong>');

  // Numbered lists: 1. ...
  html = html.replace(/^(\d+)\. (.+)$/gm,
    '<div style="display:flex;gap:8px;margin:4px 0"><span style="color:var(--accent-light);font-weight:600;flex-shrink:0">$1.</span><span>$2</span></div>'
  );

  // Bullet lists: - ...
  html = html.replace(/^ {2,}- (.+)$/gm,
    '<div style="display:flex;gap:8px;margin:2px 0 2px 16px"><span style="color:var(--text-muted)">•</span><span>$1</span></div>'
  );
  html = html.replace(/^- (.+)$/gm,
    '<div style="display:flex;gap:8px;margin:3px 0"><span style="color:var(--accent-light)">•</span><span>$1</span></div>'
  );

  // Line breaks
  html = html.replace(/\n\n/g, '<div style="height:8px"></div>');
  html = html.replace(/\n/g, '<br/>');

  return html;
}

export default function RecommendationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const scanId = searchParams.get("scanId");
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<string | null>(null);
  const [depAcknowledged, setDepAcknowledged] = useState(false);
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string; actionId?: string } | null>(null);
  const [blastRadius, setBlastRadius] = useState<BlastRadiusResult | null>(null);
  const [graphNodeCount, setGraphNodeCount] = useState<number>(0);

  const loadRecommendation = () => {
    if (!id) { setError("Missing id"); setLoading(false); return; }
    getRecommendation(id, scanId ?? undefined)
      .then((data) => { setRec(data); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRecommendation();
  }, [id, scanId]);

  useEffect(() => {
    if (!rec) return;
    const gId = extractGraphId(rec.resourceId);
    getDependencySubgraph(gId)
      .then((graph) => {
        const result = calculateBlastRadius(graph, gId);
        setBlastRadius(result);
        const connectedCount = graph.nodes ? graph.nodes.filter((n: any) => n.resourceId !== gId).length : 0;
        setGraphNodeCount(connectedCount);
      })
      .catch(() => { setBlastRadius(null); setGraphNodeCount(0); });
  }, [rec]);

  const handleActionClick = (actionType: string) => {
    setConfirmingAction(actionType);
    setDepAcknowledged(false);
    setActionResult(null);
  };

  const handleCancel = () => {
    setConfirmingAction(null);
    setDepAcknowledged(false);
  };

  const handleConfirm = async () => {
    if (!rec || !confirmingAction) return;
    setActing(true);
    setActionResult(null);
    const hasDeps = rec.dependencies && rec.dependencies.length > 0;
    try {
      const result = await initiateAction({
        recommendationId: rec.recommendationId,
        actionType: confirmingAction,
        dependencyAcknowledgment: hasDeps ? true : undefined,
      });
      setActionResult({ success: true, message: "Action executed successfully", actionId: result.actionId });
      setConfirmingAction(null);
      // Refresh recommendation data
      loadRecommendation();
    } catch (err: any) {
      setActionResult({ success: false, message: err.message });
      setConfirmingAction(null);
    } finally {
      setActing(false);
    }
  };

  const handleAction = async (actionType: string) => {
    if (!rec) return;
    setActing(true);
    setActionMsg(null);
    try {
      await initiateAction({ recommendationId: rec.recommendationId, actionType });
      setActionMsg(`Action "${actionType}" initiated`);
    } catch (err: any) {
      setActionMsg(`Failed: ${err.message}`);
    } finally {
      setActing(false);
    }
  };

  const handleAI = async () => {
    if (!rec) return;
    setAiLoading(true);
    try {
      const res = await getAIRecommendation(rec);
      setAiText(res.aiRecommendation);
    } catch (err: any) {
      setAiText(`AI unavailable: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) return <LoadingSpinner message="Loading recommendation details..." />;

  if (error || !rec) return (
    <div className="page-enter">
      <Link to="/recommendations" style={{ fontSize: 13, color: "var(--text-muted)" }}>← Back</Link>
      <div className="toast toast-error" style={{ marginTop: 16 }}>⚠️ {error || "Not found"}</div>
    </div>
  );

  // Extract short resource ID from ARN for graph lookups
  // Graph nodes use short IDs (e.g. "vol-abc123", "i-abc123", "MyRole")
  // but recommendations use full ARNs (e.g. "arn:aws:ec2:us-east-1:123:volume/vol-abc123")
  const graphResourceId = extractGraphId(rec.resourceId);

  const hasDeps = (rec.dependencies && rec.dependencies.length > 0) || graphNodeCount > 0;
  const safeToDelete = !hasDeps;
  const depCount = Math.max(rec.dependencies?.length ?? 0, graphNodeCount);
  const actions = rec.availableActions ?? (rec as any).suggestedActions ?? [];
  const reason = rec.issueDescription || rec.explanation || (rec as any).reason || "";
  const explanation = rec.explanation || "";
  const resourceName = rec.resourceId?.split(":").pop()?.split("/").pop() || rec.resourceId;

  return (
    <div className="page-enter">
      <Link to="/recommendations" style={{ fontSize: 13, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 24 }}>
        ← Back to Recommendations
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 8 }}>
            {resourceName}
          </h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={`badge badge-${rec.riskLevel.toLowerCase()}`}>{rec.riskLevel} Risk</span>
            <span className="badge badge-info">{formatAdvisor(rec.advisorType)}</span>
            {safeToDelete ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "rgba(34,197,94,0.15)", color: "#86efac" }}>
                ✓ Safe to Remove
              </span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "rgba(249,115,22,0.15)", color: "#fdba74" }}>
                ⚠ Has Dependencies
              </span>
            )}
          </div>
        </div>
      </div>

      {actionMsg && (
        <div className={`toast ${actionMsg.startsWith("Failed") ? "toast-error" : "toast-success"}`} style={{ marginBottom: 20 }}>
          {actionMsg}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Resource Details */}
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={sectionTitle}>Resource Details</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Detail label="Resource Type" value={rec.resourceType} />
              <Detail label="Region" value={rec.region} />
              <Detail label="Account" value={rec.accountId === "self" ? "Current Account" : rec.accountId} />
              <Detail label="Est. Monthly Savings" value={rec.estimatedMonthlySavings ? `$${rec.estimatedMonthlySavings.toFixed(2)}` : "—"} />
            </div>
          </div>

          {/* Issue & Explanation */}
          {reason && (
            <div className="glass-card" style={{ padding: 24 }}>
              <h3 style={sectionTitle}>Issue Detected</h3>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: explanation && explanation !== reason ? 16 : 0 }}>{reason}</p>
              {explanation && explanation !== reason && (
                <>
                  <h3 style={{ ...sectionTitle, marginTop: 16 }}>Explanation</h3>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>{explanation}</p>
                </>
              )}
            </div>
          )}

          {/* Dependency Map */}
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={sectionTitle}>Service Dependencies</h3>
            <MiniDependencyGraph resourceId={graphResourceId} height={200} />
            <Link to={`/dependency-graph?resourceId=${encodeURIComponent(graphResourceId)}`}
              style={{ fontSize: 12, color: "var(--accent-light)", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, marginBottom: 12 }}>
              🔗 View full dependency graph →
            </Link>
            {hasDeps ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#fdba74", fontWeight: 600 }}>
                    ⚠️ This resource has {depCount} connected service{depCount > 1 ? "s" : ""}
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    Deleting this resource may affect the services listed below. Review carefully before taking action.
                  </p>
                </div>
                {(rec.dependencies ?? []).map((dep, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 16, padding: "14px 16px",
                    borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                      background: "linear-gradient(135deg, rgba(249,115,22,0.15), rgba(239,68,68,0.1))",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                    }}>🔗</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>
                        {dep.resourceType}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>
                        {dep.relationship}
                      </div>
                      <code style={{ fontSize: 11, color: "var(--cyan)", background: "rgba(6,182,212,0.08)", padding: "2px 6px", borderRadius: 4, wordBreak: "break-all" }}>
                        {dep.resourceId}
                      </code>
                    </div>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", background: "var(--orange)", flexShrink: 0,
                      boxShadow: "0 0 6px var(--orange)",
                    }} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: "20px 16px", borderRadius: 10, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#86efac", marginBottom: 4 }}>No Dependencies Found</div>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  This resource is not connected to any other services. It can be safely removed without affecting your infrastructure.
                </p>
              </div>
            )}
          </div>

          {/* Resource ARN */}
          {rec.resourceId && (
            <div className="glass-card" style={{ padding: 24 }}>
              <h3 style={sectionTitle}>Resource ARN / ID</h3>
              <code style={{ fontSize: 12, color: "var(--cyan)", background: "rgba(6,182,212,0.08)", padding: "8px 12px", borderRadius: 6, display: "block", wordBreak: "break-all" }}>
                {rec.resourceId}
              </code>
            </div>
          )}
        </div>

        {/* Right sidebar — Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, alignSelf: "start" }}>
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={sectionTitle}>Quick Actions</h3>
            {actionResult && (
              <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: actionResult.success ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${actionResult.success ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: actionResult.success ? "#86efac" : "#fca5a5" }}>
                  {actionResult.success ? "Action executed successfully" : "Action failed"}
                </div>
                {actionResult.actionId && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Action ID: {actionResult.actionId}</div>}
                {!actionResult.success && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{actionResult.message}</div>}
              </div>
            )}
            {actions.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {confirmingAction ? (
                  <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
                      Are you sure you want to <strong>{confirmingAction}</strong> this resource?
                    </p>
                    {blastRadius && blastRadius.totalAffected > 0 && (
                      <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#fca5a5", marginBottom: 4 }}>
                          💥 Blast Radius: {blastRadius.totalAffected} affected resource{blastRadius.totalAffected !== 1 ? "s" : ""}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {Object.entries(blastRadius.affectedByType).map(([type, count]) => `${count} ${type}`).join(", ")}
                        </div>
                      </div>
                    )}
                    {hasDeps && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#fdba74", marginBottom: 8 }}>⚠️ Dependency Warning</div>
                        {(rec.dependencies ?? []).map((dep, i) => (
                          <div key={i} style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                            • {dep.relationship} ({dep.resourceId})
                          </div>
                        ))}
                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
                          <input type="checkbox" checked={depAcknowledged} onChange={(e) => setDepAcknowledged(e.target.checked)} />
                          I acknowledge the dependencies and want to proceed
                        </label>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }}
                        onClick={handleConfirm} disabled={acting || (hasDeps && !depAcknowledged)}>
                        {acting ? <span className="spinner" /> : null} Confirm {confirmingAction}
                      </button>
                      <button className="btn-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={handleCancel}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  actions.map((action: string, i: number) => (
                    <button key={i} className={safeToDelete ? "btn-primary" : "btn-secondary"} style={{ width: "100%", justifyContent: "center" }}
                      onClick={() => handleActionClick(action)} disabled={acting}>
                      {action}
                    </button>
                  ))
                )}
                {!safeToDelete && !confirmingAction && (
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    ⚠ This resource has dependencies. Proceed with caution.
                  </p>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No automated actions available.</p>
            )}
          </div>

          {/* Safety Summary */}
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={sectionTitle}>Safety Assessment</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22,
                background: safeToDelete
                  ? "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(6,182,212,0.1))"
                  : "linear-gradient(135deg, rgba(249,115,22,0.15), rgba(239,68,68,0.1))",
              }}>
                {safeToDelete ? "🟢" : "🟡"}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: safeToDelete ? "#86efac" : "#fdba74" }}>
                  {safeToDelete ? "Safe to Remove" : "Review Required"}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {safeToDelete ? "No connected services detected" : `${depCount} connected service${depCount > 1 ? "s" : ""} found`}
                </div>
              </div>
            </div>
            {rec.suggestedAction && (
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent-light)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Suggested Action</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{rec.suggestedAction}</div>
              </div>
            )}
          </div>

          {/* AI Recommendation */}
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={sectionTitle}>🤖 AI Analysis</h3>
            {aiText ? (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(aiText) }} />
            ) : (
              <div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>Get an AI-powered analysis and remediation plan using Amazon Bedrock.</p>
                <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={handleAI} disabled={aiLoading}>
                  {aiLoading ? <><span className="spinner" /> Analyzing...</> : "🧠 Get AI Recommendation"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "var(--text-muted)",
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16,
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function formatAdvisor(name: string): string {
  return name.replace(/([A-Z])/g, " $1").trim();
}

/** Extract the short resource ID used by the dependency graph from a full ARN.
 *  e.g. "arn:aws:ec2:us-east-1:123:volume/vol-abc" → "vol-abc"
 *       "arn:aws:iam::123:role/MyRole" → "MyRole"
 *       "vol-abc" → "vol-abc" (already short)
 */
function extractGraphId(resourceId: string): string {
  if (!resourceId.startsWith("arn:")) return resourceId;
  // ARN format: arn:partition:service:region:account:resource
  // resource part can be "type/id", "type:id", or just "id"
  const parts = resourceId.split(":");
  const resource = parts.slice(5).join(":");
  // Handle "type/id" format — take the last segment after /
  if (resource.includes("/")) {
    return resource.split("/").pop() || resource;
  }
  return resource;
}
