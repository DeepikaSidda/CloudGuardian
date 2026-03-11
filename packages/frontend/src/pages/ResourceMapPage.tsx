import { useState, useEffect, useRef } from "react";
import { getRecommendations, getAIRecommendation } from "../api-client";
import type { Recommendation } from "@governance-engine/shared";
import LoadingSpinner from "../components/LoadingSpinner";

function useAnimatedNumber(target: number, duration = 1000) {
  const [val, setVal] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const start = ref.current;
    const diff = target - start;
    if (diff === 0) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = Math.round(start + diff * eased);
      setVal(cur);
      ref.current = cur;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return val;
}

const shortName = (id: string) => id?.split(":").pop()?.split("/").pop() || id;

const riskColor: Record<string, string> = { High: "#ef4444", Medium: "#f59e0b", Low: "#22c55e" };

const typeIcons: Record<string, string> = {
  EC2Instance: "🖥️", EBSVolume: "💾", ElasticIP: "🌐", LoadBalancer: "⚖️",
  SecurityGroup: "🛡️", IAMUser: "👤", IAMRole: "🔑", LambdaFunction: "⚡",
  RDSInstance: "🗄️", ECSService: "🐳", NATGateway: "🚪", CloudWatchLogGroup: "📋",
  S3Bucket: "🪣", DynamoDBTable: "📊", SNSTopic: "📢", SQSQueue: "📬",
  StepFunction: "🔄", CloudFormationStack: "📦", CloudFrontDistribution: "🌍",
  APIGatewayRestAPI: "🔌", APIGatewayHttpAPI: "🔌", Route53HostedZone: "🗺️",
  EFSFileSystem: "📁", ECRRepository: "🐋", ElastiCacheCluster: "⚡",
  EventBridgeRule: "📅", KinesisStream: "🌊", CognitoUserPool: "👥",
  SecretsManagerSecret: "🔐", ACMCertificate: "📜", KMSKey: "🗝️",
  WAFWebACL: "🛡️", CodePipeline: "🔧", CodeBuildProject: "🏗️",
  CodeCommitRepo: "📝", AmplifyApp: "📱", AutoScalingGroup: "📈",
};

function extractLastUsed(r: Recommendation): string | null {
  const text = `${r.issueDescription} ${r.explanation}`;
  const m = text.match(/(\d+)\+?\s*days?\s*(ago|unused|idle|inactive|no.*activit)/i);
  if (m) return `${m[1]}+ days ago`;
  if (/no recent activity|never used|no activity|unused/i.test(text)) return "No recent activity";
  if (/last used/i.test(text)) {
    const d = text.match(/last used[:\s]*([^,.]+)/i);
    if (d) return d[1].trim();
  }
  return null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const formatAdvisorName = (name: string): string => name.replace(/([A-Z])/g, " $1").trim();

/* ── Dependency Tree ── */
function DependencyTree({ deps }: { deps: Recommendation["dependencies"] }) {
  if (!deps || deps.length === 0) return null;
  const grouped: Record<string, typeof deps> = {};
  for (const d of deps) {
    const t = d.resourceType || "Unknown";
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(d);
  }
  const groups = Object.entries(grouped);

  return (
    <div style={{ position: "relative", paddingLeft: 20, marginTop: 12 }}>
      <div style={{ position: "absolute", left: 8, top: 0, bottom: 8, width: 2, background: "linear-gradient(180deg, var(--cyan), rgba(6,182,212,0.15))", borderRadius: 2 }} />
      {groups.map(([type, items], gi) => (
        <div key={type} style={{ marginBottom: gi < groups.length - 1 ? 14 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, position: "relative" }}>
            <div style={{ position: "absolute", left: -16, top: "50%", width: 12, height: 2, background: "var(--cyan)", transform: "translateY(-50%)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {typeIcons[type] || "📦"} {type}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", background: "rgba(255,255,255,0.04)", padding: "1px 6px", borderRadius: 8 }}>{items.length}</span>
          </div>
          {items.map((dep, di) => (
            <div key={di} style={{ position: "relative", marginLeft: 8, marginBottom: di < items.length - 1 ? 6 : 0, display: "flex", alignItems: "stretch" }}>
              <div style={{ position: "relative", width: 20, flexShrink: 0 }}>
                <div style={{ position: "absolute", left: -4, top: "50%", width: 16, height: 2, background: "rgba(6,182,212,0.3)" }} />
                <div style={{ position: "absolute", left: 12, top: "50%", width: 6, height: 6, background: "var(--cyan)", borderRadius: "50%", transform: "translate(-50%, -50%)", boxShadow: "0 0 6px rgba(6,182,212,0.4)" }} />
              </div>
              <div style={{ flex: 1, padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", transition: "all 0.2s ease" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(6,182,212,0.06)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(6,182,212,0.3)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>{shortName(dep.resourceId)}</div>
                <div style={{ fontSize: 11, color: "var(--cyan)", opacity: 0.8 }}>{dep.relationship}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Resource Card ── */
function ResourceCard({ r, index }: { r: Recommendation; index: number }) {
  const lastUsed = extractLastUsed(r);
  const hasDeps = r.dependencies && r.dependencies.length > 0;
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAi, setShowAi] = useState(false);

  const askAI = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (aiText) { setShowAi(!showAi); return; }
    setAiLoading(true); setShowAi(true);
    try {
      const res = await getAIRecommendation(r);
      setAiText(res.aiRecommendation);
    } catch (err: any) {
      setAiText(`Failed to get AI analysis: ${err.message}`);
    } finally { setAiLoading(false); }
  };

  return (
    <div className="glass-card" style={{ padding: 0, overflow: "hidden", animation: `fadeInUp 0.4s ease-out ${index * 0.06}s both`, transition: "transform 0.25s ease, box-shadow 0.25s ease" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 40px rgba(0,0,0,0.3)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = ""; }}>
      <div style={{ padding: "16px 20px 12px", borderBottom: (hasDeps || showAi) ? "1px solid var(--border)" : "none", background: `linear-gradient(135deg, rgba(${r.riskLevel === "High" ? "239,68,68" : r.riskLevel === "Medium" ? "245,158,11" : "34,197,94"},0.06), transparent)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 18 }}>{typeIcons[r.resourceType] || "📦"}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.resourceId}>{shortName(r.resourceId)}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 26 }}>{r.resourceType}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button onClick={askAI} disabled={aiLoading} style={{
              background: showAi ? "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(99,102,241,0.15))" : "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(99,102,241,0.06))",
              border: `1px solid ${showAi ? "rgba(139,92,246,0.4)" : "rgba(139,92,246,0.2)"}`,
              borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600,
              color: "var(--purple)", display: "flex", alignItems: "center", gap: 4,
              transition: "all 0.2s ease",
            }}>
              {aiLoading ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Analyzing...</> : <>🤖 Ask AI</>}
            </button>
            <span className={`badge badge-${r.riskLevel === "High" ? "high" : r.riskLevel === "Medium" ? "medium" : "low"}`}>{r.riskLevel}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
          <span title="Region">🌍 {r.region}</span>
          <span title="Last scanned">🕐 {formatTime(r.createdAt)}</span>
          {lastUsed && <span title="Last used" style={{ color: riskColor[r.riskLevel] || "var(--text-muted)" }}>⏳ {lastUsed}</span>}
          {hasDeps && <span title="Dependencies" style={{ color: "var(--cyan)" }}>🔗 {r.dependencies.length} dep{r.dependencies.length !== 1 ? "s" : ""}</span>}
          {r.estimatedMonthlySavings != null && r.estimatedMonthlySavings > 0 && <span title="Potential savings" style={{ color: "var(--green)" }}>💰 ${r.estimatedMonthlySavings.toFixed(2)}/mo</span>}
        </div>
      </div>

      {/* AI Analysis Panel */}
      {showAi && (
        <div style={{ padding: "14px 20px", borderBottom: hasDeps ? "1px solid var(--border)" : "none", background: "linear-gradient(135deg, rgba(139,92,246,0.04), rgba(99,102,241,0.02))", animation: "fadeInUp 0.3s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 14 }}>🤖</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--purple)", textTransform: "uppercase", letterSpacing: "0.06em" }}>AI Risk Analysis</span>
            <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: "auto" }}>Powered by Amazon Bedrock</span>
          </div>
          {aiLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0" }}>
              <span className="spinner" style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Analyzing resource risk with Amazon Nova...</span>
            </div>
          ) : aiText ? (
            <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--text-secondary)" }}>
              <AIMarkdown text={aiText} />
            </div>
          ) : null}
        </div>
      )}

      {hasDeps && (
        <div style={{ padding: "12px 20px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Dependency Tree</div>
          <DependencyTree deps={r.dependencies} />
        </div>
      )}
    </div>
  );
}

/* ── Simple Markdown Renderer for AI output ── */
function AIMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} style={{ height: 6 }} />;
        if (trimmed.startsWith("### ")) return <div key={i} style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginTop: 8, marginBottom: 4 }}>{trimmed.slice(4)}</div>;
        if (trimmed.startsWith("## ")) return <div key={i} style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginTop: 10, marginBottom: 4 }}>{trimmed.slice(3)}</div>;
        if (trimmed.startsWith("**") && trimmed.endsWith("**")) return <div key={i} style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginTop: 8, marginBottom: 2 }}>{trimmed.slice(2, -2)}</div>;
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) return (
          <div key={i} style={{ display: "flex", gap: 6, marginLeft: 8, marginBottom: 2 }}>
            <span style={{ color: "var(--cyan)", flexShrink: 0 }}>•</span>
            <span dangerouslySetInnerHTML={{ __html: inlineBold(trimmed.slice(2)) }} />
          </div>
        );
        if (/^\d+\.\s/.test(trimmed)) return (
          <div key={i} style={{ display: "flex", gap: 6, marginLeft: 8, marginBottom: 2 }}>
            <span style={{ color: "var(--cyan)", flexShrink: 0, fontWeight: 700 }}>{trimmed.match(/^\d+/)![0]}.</span>
            <span dangerouslySetInnerHTML={{ __html: inlineBold(trimmed.replace(/^\d+\.\s*/, "")) }} />
          </div>
        );
        if (trimmed.startsWith("`") && trimmed.endsWith("`")) return (
          <div key={i} style={{ fontFamily: "monospace", fontSize: 11, background: "rgba(255,255,255,0.04)", padding: "4px 8px", borderRadius: 4, margin: "4px 0", color: "var(--cyan)" }}>{trimmed.slice(1, -1)}</div>
        );
        return <div key={i} dangerouslySetInnerHTML={{ __html: inlineBold(trimmed) }} />;
      })}
    </div>
  );
}

function inlineBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-primary)">$1</strong>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.04);padding:1px 4px;border-radius:3px;font-size:11px;color:var(--cyan)">$1</code>');
}

/* ── Independent Resources Table ── */
function IndependentTable({ resources }: { resources: Recommendation[] }) {
  return (
    <table className="data-table">
      <thead><tr><th>Resource</th><th>Type</th><th>Risk</th><th>Region</th><th>Last Scanned</th><th>Last Used</th></tr></thead>
      <tbody>
        {resources.map((r, i) => {
          const lastUsed = extractLastUsed(r);
          return (
            <tr key={r.recommendationId} style={{ animation: `fadeInUp 0.3s ease-out ${i * 0.04}s both` }}>
              <td style={{ fontWeight: 600, color: "var(--text-primary)" }} title={r.resourceId}>
                <span style={{ marginRight: 6 }}>{typeIcons[r.resourceType] || "📦"}</span>{shortName(r.resourceId)}
              </td>
              <td style={{ fontSize: 12 }}>{r.resourceType}</td>
              <td><span className={`badge badge-${r.riskLevel === "High" ? "high" : r.riskLevel === "Medium" ? "medium" : "low"}`}>{r.riskLevel}</span></td>
              <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.region}</td>
              <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatTime(r.createdAt)}</td>
              <td style={{ fontSize: 12, color: lastUsed ? riskColor[r.riskLevel] || "var(--text-muted)" : "var(--text-muted)" }}>{lastUsed || "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── Main Page ── */
export default function ResourceMapPage() {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>("All");
  const [viewBy, setViewBy] = useState<"all" | "type" | "risk" | "region" | "advisor">("all");

  useEffect(() => {
    getRecommendations()
      .then(d => { setRecs(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const byType: Record<string, Recommendation[]> = {};
  for (const r of recs) {
    const t = r.resourceType || "Unknown";
    if (!byType[t]) byType[t] = [];
    byType[t].push(r);
  }
  const types = Object.keys(byType).sort();

  const totalConnections = recs.reduce((s, r) => s + (r.dependencies?.length ?? 0), 0);
  const filtered = selectedType === "All" ? recs : (byType[selectedType] ?? []);
  const withDeps = filtered.filter(r => r.dependencies && r.dependencies.length > 0);
  const noDeps = filtered.filter(r => !r.dependencies || r.dependencies.length === 0);

  const animTotal = useAnimatedNumber(filtered.length);
  const animDeps = useAnimatedNumber(withDeps.length);
  const animIndep = useAnimatedNumber(noDeps.length);
  const animConn = useAnimatedNumber(totalConnections);

  const groupResources = (list: Recommendation[]): Record<string, Recommendation[]> => {
    const groups: Record<string, Recommendation[]> = {};
    for (const r of list) {
      let key: string;
      switch (viewBy) {
        case "type": key = r.resourceType || "Unknown"; break;
        case "risk": key = r.riskLevel || "Unknown"; break;
        case "region": key = r.region || "Unknown"; break;
        case "advisor": key = formatAdvisorName(r.advisorType) || "Unknown"; break;
        default: key = "All Resources"; break;
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return groups;
  };

  const catIcon = (key: string): string => {
    if (viewBy === "type") return typeIcons[key] || "📦";
    if (viewBy === "risk") return key === "High" ? "🔴" : key === "Medium" ? "🟠" : "🟢";
    if (viewBy === "region") return "🌍";
    if (viewBy === "advisor") {
      if (key.includes("Cleanup")) return "🧹";
      if (key.includes("Permission")) return "🔑";
      if (key.includes("Zombie")) return "🧟";
      return "🔍";
    }
    return "📦";
  };

  const catColor = (key: string): string => {
    if (viewBy === "risk") return key === "High" ? "var(--red)" : key === "Medium" ? "var(--orange)" : "var(--green)";
    if (viewBy === "advisor") {
      if (key.includes("Cleanup")) return "var(--green)";
      if (key.includes("Permission")) return "var(--purple)";
      if (key.includes("Zombie")) return "var(--orange)";
    }
    return "var(--cyan)";
  };

  const sortGroups = (groups: Record<string, Recommendation[]>): [string, Recommendation[]][] => {
    const entries = Object.entries(groups);
    if (viewBy === "risk") {
      const order: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
      return entries.sort((a, b) => (order[a[0]] ?? 99) - (order[b[0]] ?? 99));
    }
    return entries.sort((a, b) => b[1].length - a[1].length);
  };

  if (loading) return <LoadingSpinner message="Mapping your AWS resources..." />;
  if (error) return <div className="page-enter"><div className="toast toast-error">Error: {error}</div></div>;

  const sortedWithDeps = sortGroups(groupResources(withDeps));
  const sortedNoDeps = sortGroups(groupResources(noDeps));

  return (
    <div className="page-enter">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 10 }}>🗺️ Resource Relationship Map</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Visual dependency trees for every AWS resource</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <select className="form-select" style={{ width: 190 }} value={viewBy} onChange={e => setViewBy(e.target.value as any)}>
            <option value="all">📋 View: All</option>
            <option value="type">📦 By Resource Type</option>
            <option value="risk">⚠️ By Risk Level</option>
            <option value="region">🌍 By Region</option>
            <option value="advisor">🔍 By Advisor</option>
          </select>
          <select className="form-select" style={{ width: 220 }} value={selectedType} onChange={e => setSelectedType(e.target.value)}>
            <option value="All">All Types ({recs.length})</option>
            {types.map(t => <option key={t} value={t}>{typeIcons[t] || "📦"} {t} ({byType[t].length})</option>)}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="stagger-children" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
        {[
          { icon: "📦", label: "Total Resources", value: animTotal, grad: "rgba(99,102,241,0.2), rgba(139,92,246,0.1)" },
          { icon: "🔗", label: "With Dependencies", value: animDeps, grad: "rgba(34,197,94,0.2), rgba(6,182,212,0.1)" },
          { icon: "🧊", label: "Independent", value: animIndep, grad: "rgba(249,115,22,0.2), rgba(239,68,68,0.1)" },
          { icon: "🔀", label: "Total Connections", value: animConn, grad: "rgba(6,182,212,0.2), rgba(59,130,246,0.1)" },
        ].map((s, i) => (
          <div key={i} className="glass-card" style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="stat-icon" style={{ background: `linear-gradient(135deg, ${s.grad})` }}>{s.icon}</div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{s.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {recs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗺️</div>
          <div className="empty-state-title">No resources found</div>
          <div className="empty-state-desc">Run a scan to discover resource relationships across your AWS accounts.</div>
        </div>
      ) : (
        <>
          {/* Resources with Dependencies */}
          {withDeps.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--green)" }}>🔗</span> Resources with Dependencies
                <span className="badge badge-info" style={{ marginLeft: 4 }}>{withDeps.length}</span>
              </h2>
              {viewBy === "all" ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))", gap: 16 }}>
                  {withDeps.map((r, i) => <ResourceCard key={r.recommendationId} r={r} index={i} />)}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  {sortedWithDeps.map(([gk, items], gi) => (
                    <div key={gk} style={{ animation: `fadeInUp 0.4s ease-out ${gi * 0.08}s both` }}>
                      <CategoryHeader icon={catIcon(gk)} label={gk} count={items.length} color={catColor(gk)} />
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))", gap: 16 }}>
                        {items.map((r, i) => <ResourceCard key={r.recommendationId} r={r} index={i} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Independent Resources */}
          {noDeps.length > 0 && (
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--orange)" }}>🧊</span> Independent Resources
                <span className="badge badge-info" style={{ marginLeft: 4 }}>{noDeps.length}</span>
              </h2>
              {viewBy === "all" ? (
                <div className="glass-card" style={{ overflow: "hidden" }}><IndependentTable resources={noDeps} /></div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {sortedNoDeps.map(([gk, items], gi) => (
                    <div key={gk} style={{ animation: `fadeInUp 0.4s ease-out ${gi * 0.08}s both` }}>
                      <CategoryHeader icon={catIcon(gk)} label={gk} count={items.length} color={catColor(gk)} small />
                      <div className="glass-card" style={{ overflow: "hidden" }}><IndependentTable resources={items} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Category Group Header ── */
function CategoryHeader({ icon, label, count, color, small }: { icon: string; label: string; count: number; color: string; small?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, marginBottom: small ? 10 : 14,
      padding: small ? "8px 14px" : "10px 16px", borderRadius: small ? 8 : 10,
      background: `linear-gradient(135deg, ${color}12, transparent)`,
      border: `1px solid ${color}25`,
    }}>
      <span style={{ fontSize: small ? 16 : 18 }}>{icon}</span>
      <span style={{ fontSize: small ? 13 : 14, fontWeight: 700, color: "var(--text-primary)" }}>{label}</span>
      <span style={{
        fontSize: small ? 10 : 11, fontWeight: 700, color,
        background: `${color}18`, padding: small ? "1px 6px" : "2px 8px", borderRadius: 10,
      }}>
        {count} resource{count !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
