import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getRecommendations, type RecommendationFilters } from "../api-client";
import type { Recommendation } from "@governance-engine/shared";
import { getResourceTypeStyle } from "../utils/graph-styles";
import LoadingSpinner from "../components/LoadingSpinner";

export default function RecommendationsPage() {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [allRegions, setAllRegions] = useState<string[]>([]);
  const [allResourceTypes, setAllResourceTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<RecommendationFilters>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRecommendations(filters)
      .then((data) => { if (!cancelled) { setRecs(data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [JSON.stringify(filters)]);

  // Load all regions and resource types once on mount
  useEffect(() => {
    getRecommendations().then(data => {
      setAllRegions([...new Set(data.map(r => r.region).filter(Boolean))].sort());
      setAllResourceTypes([...new Set(data.map(r => r.resourceType).filter(Boolean))].sort());
    }).catch(() => {});
  }, []);

  return (
    <div className="page-enter">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>Recommendations</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Governance findings across your AWS resources</p>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <select className="form-select" style={{ width: 180 }} value={filters.riskLevel ?? ""} onChange={e => setFilters(f => ({ ...f, riskLevel: e.target.value || undefined } as any))}>
          <option value="">All Risk Levels</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
        <select className="form-select" style={{ width: 220 }} value={filters.advisorType ?? ""} onChange={e => setFilters(f => ({ ...f, advisorType: e.target.value || undefined } as any))}>
          <option value="">All Advisors</option>
          <option value="SafeCleanupAdvisor">Safe Cleanup</option>
          <option value="PermissionDriftDetector">Permission Drift</option>
          <option value="ZombieResourceDetector">Zombie Resources</option>
          <option value="GovernancePolicyEngine">Governance Policy</option>
        </select>
        <select className="form-select" style={{ width: 200 }} value={filters.resourceType ?? ""} onChange={e => setFilters(f => ({ ...f, resourceType: e.target.value || undefined } as any))}>
          <option value="">All Resource Types</option>
          {allResourceTypes.map(rt => (
            <option key={rt} value={rt}>{getResourceTypeStyle(rt).label}</option>
          ))}
        </select>
        <select className="form-select" style={{ width: 180 }} value={filters.region ?? ""} onChange={e => setFilters(f => ({ ...f, region: e.target.value || undefined }))}>
          <option value="">All Regions</option>
          {[...new Set([
            "us-east-1", "us-east-2", "us-west-1", "us-west-2",
            "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1",
            "eu-west-1", "eu-west-2", "eu-central-1",
            "sa-east-1", "ca-central-1",
            ...allRegions,
          ])].sort().map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingSpinner message="Fetching recommendations..." />
      ) : error ? (
        <div className="toast toast-error">⚠️ {error}</div>
      ) : recs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎉</div>
          <div className="empty-state-title">No findings</div>
          <div className="empty-state-desc">Your AWS resources look clean. Run a scan to check for new recommendations.</div>
        </div>
      ) : (
        <div className="glass-card" style={{ overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Advisor</th>
                <th>Risk</th>
                <th>Region</th>
                <th>Savings</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r, i) => (
                <tr key={r.recommendationId ?? i} style={{ animation: `fadeInUp 0.3s ease-out ${i * 0.03}s both` }}>
                  <td>
                    <Link to={`/recommendations/${r.recommendationId}?scanId=${r.scanId}`} style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                      {r.resourceId?.split(":").pop()?.split("/").pop() || r.resourceId}
                    </Link>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{r.resourceType}</div>
                  </td>
                  <td>{formatAdvisor(r.advisorType)}</td>
                  <td><span className={`badge badge-${r.riskLevel.toLowerCase()}`}>{r.riskLevel}</span></td>
                  <td>{r.region}</td>
                  <td style={{ color: r.estimatedMonthlySavings ? "var(--green)" : "var(--text-muted)" }}>
                    {r.estimatedMonthlySavings ? `$${r.estimatedMonthlySavings.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-muted)" }}>
        {recs.length} finding{recs.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

function formatAdvisor(name: string): string {
  return name.replace(/([A-Z])/g, " $1").trim();
}
