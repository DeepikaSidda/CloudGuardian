import { useState, useEffect, useRef } from "react";
import { getTrends, type TrendEntry } from "../api-client";
import LoadingSpinner from "../components/LoadingSpinner";

const toIST = (s: string) => {
  try { return new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return s; }
};
const toShortIST = (s: string) => {
  try { return new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", month: "short", day: "numeric" }); }
  catch { return s; }
};
const toTimeIST = (s: string) => {
  try { return new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }); }
  catch { return s; }
};

/* ── Animated Line Chart (pure SVG, no deps) ── */
function LineChart({ data }: { data: TrendEntry[] }) {
  const [animated, setAnimated] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { const t = setTimeout(() => setAnimated(true), 100); return () => clearTimeout(t); }, []);

  if (data.length < 2) return null;

  const W = 900, H = 300;
  const padL = 50, padR = 30, padT = 40, padB = 60;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const counts = data.map(d => d.recommendationCount);
  const minVal = Math.min(...counts);
  const maxVal = Math.max(...counts);
  const range = maxVal - minVal || 1;
  // Add 10% padding to Y axis
  const yMin = Math.max(0, minVal - Math.ceil(range * 0.15));
  const yMax = maxVal + Math.ceil(range * 0.15);
  const yRange = yMax - yMin || 1;

  const points = data.map((d, i) => ({
    x: padL + (i / (data.length - 1)) * chartW,
    y: padT + chartH - ((d.recommendationCount - yMin) / yRange) * chartH,
    val: d.recommendationCount,
    time: d.startTime,
  }));

  // Smooth curve using cubic bezier
  const linePath = points.map((p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const cpx = (prev.x + p.x) / 2;
    return `C ${cpx} ${prev.y}, ${cpx} ${p.y}, ${p.x} ${p.y}`;
  }).join(" ");

  const areaPath = linePath + ` L ${points[points.length - 1].x} ${padT + chartH} L ${points[0].x} ${padT + chartH} Z`;

  // Y-axis grid lines (5 lines)
  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const val = yMin + (yRange * i) / 4;
    const y = padT + chartH - ((val - yMin) / yRange) * chartH;
    return { y, label: Math.round(val) };
  });

  const pathLength = 2000; // approximate

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        <defs>
          {/* Area gradient */}
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(6,182,212,0.3)" />
            <stop offset="100%" stopColor="rgba(6,182,212,0)" />
          </linearGradient>
          {/* Line gradient */}
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          {/* Glow filter */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="dotGlow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={padL - 10} y={g.y + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize={11} fontFamily="inherit">{g.label}</text>
          </g>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="url(#areaGrad)"
          style={{ opacity: animated ? 1 : 0, transition: "opacity 1s ease 0.5s" }} />

        {/* Animated line */}
        <path d={linePath} fill="none" stroke="url(#lineGrad)" strokeWidth={2.5} strokeLinecap="round" filter="url(#glow)"
          style={{
            strokeDasharray: pathLength,
            strokeDashoffset: animated ? 0 : pathLength,
            transition: "stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)",
          }} />

        {/* Hover vertical line */}
        {hoveredIdx !== null && (
          <line x1={points[hoveredIdx].x} y1={padT} x2={points[hoveredIdx].x} y2={padT + chartH}
            stroke="rgba(6,182,212,0.3)" strokeWidth={1} strokeDasharray="4 4" />
        )}

        {/* Data points */}
        {points.map((p, i) => {
          const isLatest = i === points.length - 1;
          const isHovered = hoveredIdx === i;
          const r = isHovered ? 7 : isLatest ? 5.5 : 4;
          return (
            <g key={i} style={{ opacity: animated ? 1 : 0, transition: `opacity 0.4s ease ${0.8 + i * 0.08}s` }}>
              {/* Outer glow ring */}
              {(isLatest || isHovered) && (
                <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke="rgba(6,182,212,0.3)" strokeWidth={1.5}>
                  <animate attributeName="r" values={`${r + 2};${r + 6};${r + 2}`} dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Dot */}
              <circle cx={p.x} cy={p.y} r={r}
                fill={isLatest ? "#06b6d4" : isHovered ? "#8b5cf6" : "#8b5cf6"}
                stroke={isLatest ? "#06b6d4" : "#8b5cf6"} strokeWidth={2}
                filter={isLatest || isHovered ? "url(#dotGlow)" : undefined}
                style={{ cursor: "pointer", transition: "r 0.2s ease" }} />
              {/* Invisible hover target */}
              <circle cx={p.x} cy={p.y} r={20} fill="transparent"
                onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)} style={{ cursor: "pointer" }} />
            </g>
          );
        })}

        {/* X-axis labels */}
        {points.map((p, i) => (
          <g key={`label-${i}`}>
            <text x={p.x} y={padT + chartH + 20} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={10} fontFamily="inherit">
              {toShortIST(data[i].startTime)}
            </text>
            <text x={p.x} y={padT + chartH + 34} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize={9} fontFamily="inherit">
              {toTimeIST(data[i].startTime)}
            </text>
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredIdx !== null && (
        <div style={{
          position: "absolute",
          left: `${(points[hoveredIdx].x / W) * 100}%`,
          top: `${(points[hoveredIdx].y / H) * 100 - 14}%`,
          transform: "translate(-50%, -100%)",
          background: "rgba(15,15,30,0.95)", border: "1px solid rgba(6,182,212,0.4)",
          borderRadius: 10, padding: "10px 14px", pointerEvents: "none",
          backdropFilter: "blur(12px)", zIndex: 10,
          animation: "fadeInUp 0.2s ease",
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#06b6d4", textAlign: "center" }}>{points[hoveredIdx].val}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textAlign: "center", marginTop: 2 }}>findings</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textAlign: "center", marginTop: 4 }}>{toIST(data[hoveredIdx].startTime)}</div>
          {hoveredIdx > 0 && (() => {
            const change = data[hoveredIdx].recommendationCount - data[hoveredIdx - 1].recommendationCount;
            if (change === 0) return null;
            return (
              <div style={{ fontSize: 11, fontWeight: 700, textAlign: "center", marginTop: 4, color: change > 0 ? "#ef4444" : "#22c55e" }}>
                {change > 0 ? "▲" : "▼"} {change > 0 ? "+" : ""}{change} vs prev
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default function TrendsPage() {
  const [trends, setTrends] = useState<TrendEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getTrends()
      .then((data) => { setTrends(data); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const latest = trends.length > 0 ? trends[trends.length - 1] : null;
  const previous = trends.length > 1 ? trends[trends.length - 2] : null;
  const delta = latest && previous ? latest.recommendationCount - previous.recommendationCount : 0;
  const avg = trends.length > 0 ? Math.round(trends.reduce((s, t) => s + t.recommendationCount, 0) / trends.length) : 0;
  const peak = trends.length > 0 ? Math.max(...trends.map(t => t.recommendationCount)) : 0;

  return (
    <div className="page-enter">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>Trends</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Scan history and recommendation trends over time</p>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading scan trends..." />
      ) : error ? (
        <div className="toast toast-error">⚠️ {error}</div>
      ) : trends.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📈</div>
          <div className="empty-state-title">No trend data yet</div>
          <div className="empty-state-desc">Run a few scans to see trends appear here.</div>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="stagger-children" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
            <div className="glass-card" style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Total Scans</div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{trends.length}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>completed scans</div>
            </div>
            <div className="glass-card" style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Latest Findings</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 26, fontWeight: 800 }}>{latest?.recommendationCount ?? 0}</span>
                {delta !== 0 && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: delta > 0 ? "var(--red)" : "var(--green)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                    {delta > 0 ? "▲" : "▼"} {delta > 0 ? "+" : ""}{delta}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>vs previous scan</div>
            </div>
            <div className="glass-card" style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Average</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--cyan)" }}>{avg}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>findings per scan</div>
            </div>
            <div className="glass-card" style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Peak</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--orange)" }}>{peak}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>highest findings</div>
            </div>
          </div>

          {/* Animated Line Chart */}
          <div className="glass-card" style={{ padding: "24px 20px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, padding: "0 8px" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>📈 Findings Trend</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Last {trends.length} scans · hover for details</div>
            </div>
            <LineChart data={trends} />
          </div>

          {/* Scan History Table */}
          <div className="glass-card" style={{ overflow: "hidden", marginTop: 16 }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>📋 Scan History</div>
            </div>
            <table className="data-table">
              <thead><tr><th>#</th><th>Scan Time (IST)</th><th style={{ textAlign: "center" }}>Findings</th><th style={{ textAlign: "center" }}>Change</th></tr></thead>
              <tbody>
                {[...trends].reverse().map((t, i) => {
                  const idx = trends.length - 1 - i;
                  const prev = idx > 0 ? trends[idx - 1].recommendationCount : null;
                  const change = prev !== null ? t.recommendationCount - prev : null;
                  return (
                    <tr key={t.scanId}>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{trends.length - i}</td>
                      <td style={{ fontSize: 12 }}>{toIST(t.startTime)}</td>
                      <td style={{ textAlign: "center", fontWeight: 700, fontSize: 14 }}>{t.recommendationCount}</td>
                      <td style={{ textAlign: "center" }}>
                        {change === null ? <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span> :
                         change === 0 ? <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span> :
                         <span style={{ fontSize: 12, fontWeight: 700, color: change > 0 ? "var(--red)" : "var(--green)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                           {change > 0 ? "▲" : "▼"} {change > 0 ? "+" : ""}{change}
                         </span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
