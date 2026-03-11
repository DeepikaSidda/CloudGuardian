import React from "react";
import { Link } from "react-router-dom";
import Logo from "../Logo";

const advisors = [
  {
    icon: "🧹",
    name: "Safe Cleanup Advisor",
    gradient: "linear-gradient(135deg, #22c55e, #06b6d4)",
    bg: "rgba(34, 197, 94, 0.06)",
    borderColor: "rgba(34, 197, 94, 0.15)",
    glowColor: "rgba(34, 197, 94, 0.12)",
    accentColor: "#22c55e",
    tagline: "Find and remove unused AWS resources safely",
    description:
      "Scans your AWS account for resources that haven't been accessed or used within a configurable lookback period. It identifies idle EC2 instances, unused EBS volumes, stale snapshots, orphaned Elastic IPs, and more. Each recommendation includes a safety check to ensure the resource has no active dependencies before suggesting removal.",
    checks: [
      "Unused EBS volumes with no recent I/O",
      "Idle EC2 instances with low CPU utilization",
      "Stale EBS snapshots beyond retention period",
      "Orphaned Elastic IP addresses",
      "Unused NAT Gateways and Load Balancers",
    ],
  },
  {
    icon: "🔐",
    name: "Permission Drift Detector",
    gradient: "linear-gradient(135deg, #8b5cf6, #6366f1)",
    bg: "rgba(139, 92, 246, 0.06)",
    borderColor: "rgba(139, 92, 246, 0.15)",
    glowColor: "rgba(139, 92, 246, 0.12)",
    accentColor: "#8b5cf6",
    tagline: "Detect overly permissive IAM policies and unused permissions",
    description:
      "Analyzes IAM roles, users, and policies to find permissions that have drifted from least-privilege principles. It cross-references CloudTrail access logs with granted permissions to identify unused access, overly broad wildcard policies, and roles that haven't been assumed within the lookback window.",
    checks: [
      "IAM roles not assumed in 90+ days",
      "Policies with wildcard (*) actions or resources",
      "Users with unused access keys",
      "Inline policies that should be managed policies",
      "Cross-account trust relationships to review",
    ],
  },
  {
    icon: "🧟",
    name: "Zombie Resource Detector",
    gradient: "linear-gradient(135deg, #f97316, #ef4444)",
    bg: "rgba(249, 115, 22, 0.06)",
    borderColor: "rgba(249, 115, 22, 0.15)",
    glowColor: "rgba(249, 115, 22, 0.12)",
    accentColor: "#f97316",
    tagline: "Hunt down forgotten resources still costing you money",
    description:
      "Identifies resources that were likely created for temporary purposes (testing, debugging, one-off tasks) but were never cleaned up. These 'zombie' resources silently accumulate costs. The detector looks for naming patterns, tag absence, low utilization metrics, and resources detached from any active workload.",
    checks: [
      "Detached EBS volumes with no mount history",
      "Security groups with no associated instances",
      "Unused Lambda functions with no recent invocations",
      "CloudWatch log groups with no recent log events",
      "Unattached network interfaces",
    ],
  },
  {
    icon: "📋",
    name: "Custom Governance Policy Engine",
    gradient: "linear-gradient(135deg, #3b82f6, #0ea5e9)",
    bg: "rgba(59, 130, 246, 0.06)",
    borderColor: "rgba(59, 130, 246, 0.15)",
    glowColor: "rgba(59, 130, 246, 0.12)",
    accentColor: "#3b82f6",
    tagline: "Define custom governance rules visually — no code required",
    description:
      "Enables teams to create custom governance policies through a visual builder without writing any code. Using 10 condition operators, you can evaluate resource properties like tags, encryption settings, naming conventions, and more. Policies are automatically evaluated during every scheduled scan, enforcing your organization's standards across all accounts.",
    checks: [
      "Visual policy builder with no code required",
      "10 condition operators for flexible rules",
      "Auto-evaluated on every scheduled scan",
      "Cross-account policy enforcement",
      "Tag compliance and naming conventions",
    ],
  },
];

const steps = [
  { num: "01", icon: "🔍", title: "Scan", desc: "Trigger a scan across your AWS account or entire organization", color: "#6366f1" },
  { num: "02", icon: "🤖", title: "Analyze", desc: "Four specialized advisors evaluate your resources in parallel", color: "#8b5cf6" },
  { num: "03", icon: "💡", title: "Recommend", desc: "Get prioritized findings with risk levels and cost savings estimates", color: "#06b6d4" },
  { num: "04", icon: "⚡", title: "Remediate", desc: "Take action directly from the dashboard to fix issues instantly", color: "#22c55e" },
];

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>

      {/* Hero Section */}
      <div style={{
        position: "relative", textAlign: "center", padding: "48px 24px 56px",
        marginBottom: 48, borderRadius: 24, overflow: "hidden",
        background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.04), rgba(6,182,212,0.06))",
        border: "1px solid rgba(99,102,241,0.12)",
      }}>
        {/* Animated gradient orbs */}
        <div style={{
          position: "absolute", top: -60, left: -60, width: 200, height: 200,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.15), transparent 70%)",
          animation: "float1 8s ease-in-out infinite", pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: -40, right: -40, width: 160, height: 160,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.12), transparent 70%)",
          animation: "float2 10s ease-in-out infinite", pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", top: "30%", right: "20%", width: 100, height: 100,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(6,182,212,0.1), transparent 70%)",
          animation: "float3 12s ease-in-out infinite", pointerEvents: "none",
        }} />

        <div style={{
          position: "relative", zIndex: 1,
        }}>
          <div style={{
            margin: "0 auto 16px", display: "flex", justifyContent: "center",
            animation: "heroIcon 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both",
          }}><Logo size={300} /></div>

          <h1 style={{
            fontSize: 40, fontWeight: 800, letterSpacing: "-0.04em",
            marginBottom: 8,
            background: "linear-gradient(135deg, #f1f5f9, #94a3b8)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            animation: "fadeInUp 0.6s ease-out 0.15s both",
          }}>
            CloudGuardian
          </h1>
          <div style={{
            fontSize: 14, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
            color: "var(--accent-light)", marginBottom: 16,
            animation: "fadeInUp 0.6s ease-out 0.25s both",
          }}>
            Keep Your Cloud Clean
          </div>
          <p style={{
            fontSize: 16, color: "var(--text-secondary)", maxWidth: 540, margin: "0 auto",
            lineHeight: 1.8, animation: "fadeInUp 0.6s ease-out 0.35s both",
          }}>
            An intelligent governance engine that continuously scans your cloud infrastructure,
            detects waste, security risks, and forgotten resources — then helps you fix them.
          </p>
        </div>
      </div>

      {/* How it works — horizontal timeline */}
      <div style={{ marginBottom: 56 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-light)", marginBottom: 8 }}>
            How It Works
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>Four simple steps</h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, position: "relative" }}>
          {/* Connecting line */}
          <div style={{
            position: "absolute", top: 32, left: "12.5%", right: "12.5%", height: 2,
            background: "linear-gradient(90deg, rgba(99,102,241,0.3), rgba(139,92,246,0.3), rgba(6,182,212,0.3), rgba(34,197,94,0.3))",
            zIndex: 0,
          }} />

          {steps.map((s, i) => (
            <div key={s.num} style={{
              display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
              position: "relative", zIndex: 1, padding: "0 12px",
              animation: `fadeInUp 0.5s ease-out ${0.1 + i * 0.12}s both`,
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: 20,
                background: `linear-gradient(135deg, ${s.color}22, ${s.color}08)`,
                border: `2px solid ${s.color}33`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 26, marginBottom: 16,
                boxShadow: `0 4px 20px ${s.color}20`,
                transition: "all 0.3s ease",
              }}>{s.icon}</div>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                color: s.color, marginBottom: 6, opacity: 0.7,
              }}>STEP {s.num}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 170 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Advisors Section */}
      <div style={{ marginBottom: 56 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-light)", marginBottom: 8 }}>
            Powered By
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>Meet the Advisors</h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {advisors.map((a, idx) => (
            <div key={a.name} style={{
              borderRadius: 20, overflow: "hidden", position: "relative",
              background: a.bg, border: `1px solid ${a.borderColor}`,
              transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
              animation: `fadeInUp 0.5s ease-out ${0.1 + idx * 0.12}s both`,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)";
              (e.currentTarget as HTMLElement).style.boxShadow = `0 12px 40px ${a.glowColor}`;
              (e.currentTarget as HTMLElement).style.borderColor = a.accentColor + "44";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
              (e.currentTarget as HTMLElement).style.borderColor = a.borderColor;
            }}>
              {/* Top accent bar */}
              <div style={{ height: 3, background: a.gradient }} />

              <div style={{ padding: "28px 32px" }}>
                <div style={{ display: "flex", gap: 24 }}>
                  {/* Icon */}
                  <div style={{
                    width: 64, height: 64, borderRadius: 18, flexShrink: 0,
                    background: a.gradient,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 30,
                    boxShadow: `0 8px 24px ${a.accentColor}30, inset 0 1px 0 rgba(255,255,255,0.15)`,
                  }}>{a.icon}</div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: 19, fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>{a.name}</h3>
                    <p style={{ fontSize: 13, color: a.accentColor, fontWeight: 600, marginBottom: 14, letterSpacing: "-0.01em" }}>{a.tagline}</p>
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.8, marginBottom: 20 }}>{a.description}</p>

                    <div style={{
                      padding: "16px 20px", borderRadius: 12,
                      background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.04)",
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                        color: a.accentColor, marginBottom: 12, opacity: 0.8,
                      }}>What it checks</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
                        {a.checks.map((c, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                            <span style={{
                              width: 16, height: 16, borderRadius: 5, flexShrink: 0, marginTop: 1,
                              background: `${a.accentColor}18`, border: `1px solid ${a.accentColor}30`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 8, color: a.accentColor,
                            }}>✓</span>
                            {c}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{
        textAlign: "center", padding: "40px 24px",
        borderRadius: 20, marginBottom: 24,
        background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.04))",
        border: "1px solid rgba(99,102,241,0.12)",
        animation: "fadeInUp 0.5s ease-out 0.6s both",
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Ready to secure your cloud?</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>Head to the dashboard and trigger your first scan.</p>
        <Link to="/" style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "12px 32px", borderRadius: 12,
          background: "var(--gradient-1)", color: "#fff",
          fontSize: 14, fontWeight: 600, textDecoration: "none",
          boxShadow: "0 4px 16px var(--accent-glow)",
          transition: "all 0.25s ease",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px var(--accent-glow)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px var(--accent-glow)"; }}
        >
          📊 Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
