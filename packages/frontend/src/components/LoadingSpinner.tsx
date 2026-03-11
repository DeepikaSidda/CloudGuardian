import { useState, useEffect } from "react";

const tips = [
  "Scanning your AWS resources...",
  "Fetching details from your account...",
  "Analyzing resource configurations...",
  "Checking for optimization opportunities...",
  "Gathering cost and usage data...",
  "Evaluating security posture...",
];

export default function LoadingSpinner({ message }: { message?: string }) {
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * tips.length));

  useEffect(() => {
    const t = setInterval(() => setTipIdx(i => (i + 1) % tips.length), 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="page-enter" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 400, gap: 24 }}>
      <div style={{ position: "relative", width: 56, height: 56 }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          border: "3px solid rgba(255,255,255,0.06)",
          borderTopColor: "var(--accent-light)",
          animation: "spinRing 1s linear infinite",
        }} />
        <div style={{
          position: "absolute", inset: 6,
          borderRadius: "50%",
          border: "3px solid rgba(255,255,255,0.04)",
          borderBottomColor: "var(--cyan)",
          animation: "spinRing 1.5s linear infinite reverse",
        }} />
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20,
        }}>☁️</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
          {message ?? tips[tipIdx]}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>This may take a moment</div>
      </div>
      <style>{`
        @keyframes spinRing { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
