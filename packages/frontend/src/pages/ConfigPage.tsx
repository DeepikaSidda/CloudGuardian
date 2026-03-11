import React, { useState, useEffect, useRef, useCallback } from "react";
import { getConfig, updateConfig, getSummary, getSetting, putSetting, clearScanHistory, type DashboardSummary } from "../api-client";
import type { GovernanceConfig } from "@governance-engine/shared";
import { playSuccessSound, playErrorSound } from "../utils/sounds";
import LoadingSpinner from "../components/LoadingSpinner";

interface AppSettings {
  dashboardRefreshInterval: number;
  defaultPage: string;
  timezone: string;
  showBillingSection: boolean;
  budgetThreshold: number;
  toastDuration: number;
  showToastOnScanComplete: boolean;
  showToastOnErrors: boolean;
  soundEnabled: boolean;
  scanHistoryLimit: number;
  autoCleanupEnabled: boolean;
  autoCleanupDays: number;
  advisorToggles: { safeCleanup: boolean; permissionDrift: boolean; zombieResource: boolean; governancePolicy: boolean };
}

const DEFAULT_SETTINGS: AppSettings = {
  dashboardRefreshInterval: 30,
  defaultPage: "/",
  timezone: "UTC",
  showBillingSection: true,
  budgetThreshold: 100,
  toastDuration: 5,
  showToastOnScanComplete: true,
  showToastOnErrors: true,
  soundEnabled: false,
  scanHistoryLimit: 50,
  autoCleanupEnabled: false,
  autoCleanupDays: 90,
  advisorToggles: { safeCleanup: true, permissionDrift: true, zombieResource: true, governancePolicy: true },
};

const PAGES = [
  { value: "/", label: "Dashboard" },
  { value: "/recommendations", label: "Recommendations" },
  { value: "/active-services", label: "Active Services" },
  { value: "/resource-map", label: "Resource Map" },
  { value: "/dependency-graph", label: "Dependencies" },
  { value: "/policies", label: "Policies" },
  { value: "/cost-anomalies", label: "Cost Anomalies" },
  { value: "/trends", label: "Trends" },
  { value: "/actions", label: "Actions" },
  { value: "/assistant", label: "Assistant" },
];

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Tokyo", "Asia/Shanghai",
  "Asia/Kolkata", "Australia/Sydney", "Pacific/Auckland",
];

export default function ConfigPage() {
  const [config, setConfig] = useState<GovernanceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [accountInfo, setAccountInfo] = useState<{ accountId: string; accountName: string; findings: number; savings: number; region: string } | null>(null);
  const originalRef = useRef<string>("");
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [appSettingsOriginal, setAppSettingsOriginal] = useState<string>(JSON.stringify(DEFAULT_SETTINGS));
  const [dangerConfirm, setDangerConfirm] = useState<string | null>(null);
  const [dangerLoading, setDangerLoading] = useState(false);

  useEffect(() => {
    getConfig()
      .then((data) => { setConfig(data); originalRef.current = JSON.stringify(data); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    getSummary().then((s: DashboardSummary) => {
      const acctInfo = (s as any).accountInfo;
      const perAccount = (s as any).perAccount ?? {};
      const acctId = acctInfo?.accountId ?? "";
      const acctData = perAccount[acctId] ?? perAccount["self"] ?? {};
      setAccountInfo({
        accountId: acctId,
        accountName: acctInfo?.accountName ?? acctId,
        findings: acctData.recommendationCount ?? 0,
        savings: acctData.costSavings ?? 0,
        region: "us-east-1",
      });
    }).catch(() => {});
    // Load app settings
    getSetting<AppSettings>("app_settings").then(res => {
      if (res.value) {
        const merged = { ...DEFAULT_SETTINGS, ...res.value, advisorToggles: { ...DEFAULT_SETTINGS.advisorToggles, ...(res.value.advisorToggles ?? {}) } };
        setAppSettings(merged);
        setAppSettingsOriginal(JSON.stringify(merged));
      }
    }).catch(() => {});
  }, []);

  const updateField = (updater: (c: GovernanceConfig) => GovernanceConfig) => {
    if (!config) return;
    const next = updater(config);
    setConfig(next);
    setHasChanges(JSON.stringify(next) !== originalRef.current || JSON.stringify(appSettings) !== appSettingsOriginal);
  };

  const updateAppSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setAppSettings(prev => {
      const next = { ...prev, [key]: value };
      // Auto-save boolean toggles immediately so they persist across navigation
      if (typeof value === "boolean" || (key === "advisorToggles" && typeof value === "object")) {
        putSetting("app_settings", next).then(() => {
          setAppSettingsOriginal(JSON.stringify(next));
          setHasChanges(config ? JSON.stringify(config) !== originalRef.current : false);
        }).catch(() => {});
      } else {
        setHasChanges(JSON.stringify(next) !== appSettingsOriginal || (config ? JSON.stringify(config) !== originalRef.current : false));
      }
      return next;
    });
  }, [appSettingsOriginal, config]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true); setSuccess(false); setError(null);
    try {
      const updated = await updateConfig(config);
      setConfig(updated); originalRef.current = JSON.stringify(updated);
      await putSetting("app_settings", appSettings);
      setAppSettingsOriginal(JSON.stringify(appSettings));
      setHasChanges(false); setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleExportSettings = () => {
    const data = { config, appSettings, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "cloudguardian-settings.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleResetSettings = async () => {
    setDangerLoading(true);
    try {
      setAppSettings(DEFAULT_SETTINGS);
      await putSetting("app_settings", DEFAULT_SETTINGS);
      setAppSettingsOriginal(JSON.stringify(DEFAULT_SETTINGS));
      setDangerConfirm(null); setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) { setError(err.message); }
    finally { setDangerLoading(false); }
  };

  const handleClearHistory = async () => {
    setDangerLoading(true);
    try {
      await clearScanHistory();
      setDangerConfirm(null); setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) { setError(err.message); }
    finally { setDangerLoading(false); }
  };

  if (loading) return <LoadingSpinner message="Loading your settings..." />;

  if (!config) return <div className="toast toast-error">Failed to load config</div>;

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
    marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "11px 14px", fontSize: 13, fontWeight: 500,
    background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)",
    borderRadius: 10, color: "var(--text-primary)", outline: "none",
    transition: "all 0.2s ease", fontFamily: "inherit",
  };
  const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "none" as any, cursor: "pointer" };
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-glow)"; },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; },
  };

  const sectionHeader = (icon: string, title: string, desc: string, gradient: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
      <div style={{
        width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
        background: gradient, fontSize: 20, flexShrink: 0, boxShadow: `0 4px 12px rgba(0,0,0,0.15)`,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );

  const Toggle = ({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) => (
    <label style={{
      display: "flex", alignItems: "center", gap: 14, cursor: "pointer", padding: "14px 18px",
      borderRadius: 12, background: checked ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.02)",
      border: checked ? "1px solid rgba(99,102,241,0.25)" : "1px solid var(--border)",
      transition: "all 0.3s ease",
    }}>
      <div style={{
        width: 44, height: 24, borderRadius: 12, position: "relative", cursor: "pointer",
        background: checked ? "var(--accent)" : "rgba(255,255,255,0.15)",
        transition: "background 0.3s ease", flexShrink: 0,
      }} onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
        <div style={{
          width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute",
          top: 2, left: checked ? 22 : 2,
          transition: "left 0.3s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{desc}</div>}
      </div>
    </label>
  );

  const advisors = [
    { key: "safeCleanupAdvisor" as const, label: "Safe Cleanup", icon: "🧹", color: "#22c55e", gradient: "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(34,197,94,0.05))" },
    { key: "permissionDriftDetector" as const, label: "Permission Drift", icon: "🔐", color: "#6366f1", gradient: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(99,102,241,0.05))" },
    { key: "zombieResourceDetector" as const, label: "Zombie Resources", icon: "🧟", color: "#f59e0b", gradient: "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05))" },
  ];

  return (
    <div className="page-enter" style={{ padding: "0 8px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>⚙️ Settings</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Configure scan behavior, dashboard preferences, and notifications</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {hasChanges && <span style={{ fontSize: 11, color: "var(--accent-light)", fontWeight: 600, animation: "fadeIn 0.3s ease" }}>Unsaved changes</span>}
          <button className="btn-primary" onClick={handleSave} disabled={saving || !hasChanges}
            style={{ padding: "11px 24px", fontSize: 13, fontWeight: 700, borderRadius: 10, opacity: hasChanges ? 1 : 0.5 }}>
            {saving ? <><span className="spinner" /> Saving...</> : "💾 Save Changes"}
          </button>
        </div>
      </div>

      {success && <div className="toast toast-success" style={{ marginBottom: 16, animation: "fadeInUp 0.3s ease" }}>✅ Settings saved successfully</div>}
      {error && <div className="toast toast-error" style={{ marginBottom: 16 }}>⚠️ {error}</div>}

      <div className="stagger-children" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Account Info */}
        {accountInfo && (
          <div className="glass-card" style={{ padding: "28px 32px" }}>
            {sectionHeader("🏢", "Account Information", "Your connected AWS account details", "linear-gradient(135deg, #6366f1, #3b82f6)")}
            <div style={{ display: "flex", alignItems: "stretch", gap: 0, borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ width: 4, background: "var(--gradient-1)", flexShrink: 0 }} />
              <div style={{ flex: 1, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.08))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🛡️</div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{accountInfo.accountName !== accountInfo.accountId ? accountInfo.accountName : "AWS Account"}</span>
                      <span className="badge badge-info" style={{ fontSize: 10 }}>Primary</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <code style={{ fontSize: 12, color: "var(--cyan)", background: "rgba(6,182,212,0.08)", padding: "2px 8px", borderRadius: 4 }}>{accountInfo.accountId}</code>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{accountInfo.region}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Findings</div>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{accountInfo.findings}</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Savings</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)" }}>${accountInfo.savings.toFixed(2)}</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Status</div>
                    <span className="badge badge-low">● Connected</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 1. Dashboard Preferences */}
        <div className="glass-card" style={{ padding: "28px 32px" }}>
          {sectionHeader("🖥️", "Dashboard Preferences", "Customize your dashboard experience", "linear-gradient(135deg, #8b5cf6, #6366f1)")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
            <div>
              <label style={labelStyle}>Auto-Refresh Interval</label>
              <select style={selectStyle} value={appSettings.dashboardRefreshInterval}
                onChange={e => updateAppSetting("dashboardRefreshInterval", +e.target.value)}>
                <option value={15}>Every 15 seconds</option>
                <option value={30}>Every 30 seconds</option>
                <option value={60}>Every 1 minute</option>
                <option value={120}>Every 2 minutes</option>
                <option value={300}>Every 5 minutes</option>
                <option value={0}>Disabled</option>
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>How often the dashboard auto-refreshes data</div>
            </div>
            <div>
              <label style={labelStyle}>Default Landing Page</label>
              <select style={selectStyle} value={appSettings.defaultPage}
                onChange={e => updateAppSetting("defaultPage", e.target.value)}>
                {PAGES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Page shown when you open CloudGuardian</div>
            </div>
            <div>
              <label style={labelStyle}>Timezone</label>
              <select style={selectStyle} value={appSettings.timezone}
                onChange={e => updateAppSetting("timezone", e.target.value)}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Timezone for displaying dates and times</div>
            </div>
          </div>
        </div>

        {/* Scan Configuration */}
        <div className="glass-card" style={{ padding: "28px 32px" }}>
          {sectionHeader("🔍", "Scan Configuration", "Control how and when CloudGuardian scans your AWS resources", "linear-gradient(135deg, #6366f1, #8b5cf6)")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <label style={labelStyle}>Scan Frequency</label>
              <select style={selectStyle} value={(() => {
                const s = config.scanSchedule ?? "";
                const map: Record<string, string> = {
                  "cron(0 * * * ? *)": "1h", "cron(0 */2 * * ? *)": "2h",
                  "cron(0 */4 * * ? *)": "4h", "cron(0 */6 * * ? *)": "6h",
                  "cron(0 */12 * * ? *)": "12h", "cron(0 2 * * ? *)": "daily",
                };
                return map[s] ?? "2h";
              })()} onChange={e => {
                const map: Record<string, string> = {
                  "1h": "cron(0 * * * ? *)", "2h": "cron(0 */2 * * ? *)",
                  "4h": "cron(0 */4 * * ? *)", "6h": "cron(0 */6 * * ? *)",
                  "12h": "cron(0 */12 * * ? *)", "daily": "cron(0 2 * * ? *)",
                };
                updateField(c => ({ ...c, scanSchedule: map[e.target.value] }));
              }}>
                <option value="1h">Every 1 hour</option>
                <option value="2h">Every 2 hours</option>
                <option value="4h">Every 4 hours</option>
                <option value="6h">Every 6 hours</option>
                <option value="12h">Every 12 hours</option>
                <option value="daily">Once a day (2:00 AM UTC)</option>
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>How often CloudGuardian scans your AWS resources</div>
            </div>
            <div>
              <label style={labelStyle}>Scan Mode</label>
              <select style={selectStyle} value={config.scanMode} onChange={e => updateField(c => ({ ...c, scanMode: e.target.value as any }))}>
                <option value="single-account">Single Account</option>
                <option value="organization">Organization (Multi-Account)</option>
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Single account scans current account only</div>
            </div>
            <div>
              <label style={labelStyle}>Regions</label>
              <input style={inputStyle} value={(config.regions ?? []).join(", ")}
                onChange={e => updateField(c => ({ ...c, regions: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))}
                placeholder="us-east-1, eu-west-1" {...focusHandlers} />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Comma-separated list of AWS regions to scan</div>
            </div>
            <div>
              <label style={labelStyle}>Cross-Account Role Name</label>
              <input style={inputStyle} value={config.crossAccountRoleName ?? ""}
                onChange={e => updateField(c => ({ ...c, crossAccountRoleName: e.target.value }))}
                placeholder="GovernanceEngineReadOnlyRole" {...focusHandlers} />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>IAM role assumed in member accounts (org mode)</div>
            </div>
          </div>
        </div>

        {/* 2. Cost & Billing Settings */}
        <div className="glass-card" style={{ padding: "28px 32px" }}>
          {sectionHeader("💳", "Cost & Billing Settings", "Control billing display and budget alerts", "linear-gradient(135deg, #22c55e, #06b6d4)")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <Toggle checked={appSettings.showBillingSection} onChange={v => updateAppSetting("showBillingSection", v)}
                label="Show Billing Section" desc="Display cost and billing data on the dashboard" />
            </div>
            <div>
              <label style={labelStyle}>Monthly Budget Threshold</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 14, fontWeight: 700, color: "var(--text-muted)" }}>$</span>
                <input style={{ ...inputStyle, paddingLeft: 28 }} type="number" min={0} step={10}
                  value={appSettings.budgetThreshold}
                  onChange={e => updateAppSetting("budgetThreshold", +e.target.value)} {...focusHandlers} />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Get alerted when projected costs exceed this amount</div>
            </div>
          </div>
        </div>

        {/* 3. Notification Preferences */}
        <div className="glass-card" style={{ padding: "28px 32px" }}>
          {sectionHeader("🔔", "Notification Preferences", "Control toast notifications and alerts", "linear-gradient(135deg, #f59e0b, #ef4444)")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <Toggle checked={appSettings.showToastOnScanComplete} onChange={v => updateAppSetting("showToastOnScanComplete", v)}
              label="Scan Complete Notifications" desc="Show a toast when a scan finishes" />
            <Toggle checked={appSettings.showToastOnErrors} onChange={v => updateAppSetting("showToastOnErrors", v)}
              label="Error Notifications" desc="Show a toast when errors occur" />
            <Toggle checked={appSettings.soundEnabled} onChange={v => updateAppSetting("soundEnabled", v)}
              label="Sound Effects" desc="Play a sound for important notifications" />
            {appSettings.soundEnabled && (
              <div style={{ display: "flex", gap: 8, marginTop: -4 }}>
                <button onClick={playSuccessSound} style={{
                  flex: 1, padding: "8px 12px", fontSize: 11, fontWeight: 700, borderRadius: 8,
                  background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)",
                  color: "#22c55e", cursor: "pointer", transition: "all 0.2s ease",
                }}>🔔 Test Success</button>
                <button onClick={playErrorSound} style={{
                  flex: 1, padding: "8px 12px", fontSize: 11, fontWeight: 700, borderRadius: 8,
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                  color: "#ef4444", cursor: "pointer", transition: "all 0.2s ease",
                }}>🔕 Test Error</button>
              </div>
            )}
            <div>
              <label style={labelStyle}>Toast Duration</label>
              <select style={selectStyle} value={appSettings.toastDuration}
                onChange={e => updateAppSetting("toastDuration", +e.target.value)}>
                <option value={3}>3 seconds</option>
                <option value={5}>5 seconds</option>
                <option value={8}>8 seconds</option>
                <option value={10}>10 seconds</option>
                <option value={0}>Until dismissed</option>
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>How long toast notifications stay visible</div>
            </div>
          </div>
        </div>

        {/* 4. Data Retention */}
        <div className="glass-card" style={{ padding: "28px 32px" }}>
          {sectionHeader("🗄️", "Data Retention", "Manage scan history and data cleanup", "linear-gradient(135deg, #06b6d4, #3b82f6)")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <label style={labelStyle}>Scan History Limit</label>
              <select style={selectStyle} value={appSettings.scanHistoryLimit}
                onChange={e => updateAppSetting("scanHistoryLimit", +e.target.value)}>
                <option value={10}>Last 10 scans</option>
                <option value={25}>Last 25 scans</option>
                <option value={50}>Last 50 scans</option>
                <option value={100}>Last 100 scans</option>
                <option value={0}>Unlimited</option>
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Maximum number of scan records to keep</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Toggle checked={appSettings.autoCleanupEnabled} onChange={v => updateAppSetting("autoCleanupEnabled", v)}
                label="Auto-Cleanup" desc="Automatically remove old scan data" />
              {appSettings.autoCleanupEnabled && (
                <div>
                  <label style={labelStyle}>Cleanup After</label>
                  <select style={selectStyle} value={appSettings.autoCleanupDays}
                    onChange={e => updateAppSetting("autoCleanupDays", +e.target.value)}>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                    <option value={180}>180 days</option>
                    <option value={365}>1 year</option>
                  </select>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Remove scan data older than this</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 5. Advisor Toggles */}
        <div className="glass-card" style={{ padding: "28px 32px" }}>
          {sectionHeader("🛡️", "Advisor Toggles", "Enable or disable individual security advisors", "linear-gradient(135deg, #ec4899, #8b5cf6)")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            {[
              { key: "safeCleanup" as const, icon: "🧹", label: "Safe Cleanup Advisor", desc: "Identifies unused resources safe to remove", color: "#22c55e" },
              { key: "permissionDrift" as const, icon: "🔐", label: "Permission Drift Detector", desc: "Detects overly permissive IAM policies", color: "#6366f1" },
              { key: "zombieResource" as const, icon: "🧟", label: "Zombie Resource Detector", desc: "Finds abandoned or orphaned resources", color: "#f59e0b" },
              { key: "governancePolicy" as const, icon: "📋", label: "Governance Policy Engine", desc: "Evaluates custom governance policies", color: "#ec4899" },
            ].map(a => (
              <div key={a.key} style={{
                padding: "18px 20px", borderRadius: 14,
                background: appSettings.advisorToggles[a.key] ? `${a.color}10` : "rgba(255,255,255,0.02)",
                border: `1px solid ${appSettings.advisorToggles[a.key] ? `${a.color}40` : "var(--border)"}`,
                transition: "all 0.3s ease", position: "relative", overflow: "hidden",
              }}>
                {appSettings.advisorToggles[a.key] && (
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${a.color}, transparent)` }} />
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 24 }}>{a.icon}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{a.label}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{a.desc}</div>
                    </div>
                  </div>
                  <div style={{
                    width: 44, height: 24, borderRadius: 12, position: "relative", cursor: "pointer",
                    background: appSettings.advisorToggles[a.key] ? a.color : "rgba(255,255,255,0.15)",
                    transition: "background 0.3s ease", flexShrink: 0,
                  }} onClick={() => updateAppSetting("advisorToggles", { ...appSettings.advisorToggles, [a.key]: !appSettings.advisorToggles[a.key] })}>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute",
                      top: 2, left: appSettings.advisorToggles[a.key] ? 22 : 2,
                      transition: "left 0.3s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                    }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Lookback Periods */}
        <div className="glass-card" style={{ padding: "28px 32px" }}>
          {sectionHeader("⏰", "Lookback Periods", "How far back each advisor looks when evaluating resources", "linear-gradient(135deg, #06b6d4, #3b82f6)")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {advisors.map(a => {
              const val = config.lookbackPeriods?.[a.key] ?? 90;
              return (
                <div key={a.key} style={{
                  padding: "22px 20px", borderRadius: 14, background: a.gradient,
                  border: "1px solid var(--border)", transition: "all 0.3s ease",
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${a.color}, transparent)`, borderRadius: "14px 14px 0 0" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 22 }}>{a.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{a.label}</span>
                  </div>
                  <div style={{ textAlign: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 36, fontWeight: 800, color: a.color, lineHeight: 1 }}>{val}</span>
                    <span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: 4 }}>days</span>
                  </div>
                  <input type="range" min={7} max={365} value={val}
                    onChange={e => updateField(c => ({ ...c, lookbackPeriods: { ...c.lookbackPeriods!, [a.key]: +e.target.value } }))}
                    style={{
                      width: "100%", height: 6, borderRadius: 3, appearance: "none", cursor: "pointer",
                      background: `linear-gradient(to right, ${a.color} ${((val - 7) / (365 - 7)) * 100}%, rgba(255,255,255,0.1) ${((val - 7) / (365 - 7)) * 100}%)`,
                      outline: "none", marginBottom: 8,
                    }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)" }}>
                    <span>7 days</span><span>365 days</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Report Settings */}
        <div className="glass-card" style={{ padding: "28px 32px" }}>
          {sectionHeader("📧", "Report Settings", "Configure automated email reports with scan summaries", "linear-gradient(135deg, #f59e0b, #ef4444)")}
          <div style={{ marginBottom: 20 }}>
            <Toggle checked={config.reportConfig?.enabled ?? false}
              onChange={v => updateField(c => ({ ...c, reportConfig: { ...c.reportConfig!, enabled: v } }))}
              label="Enable scheduled reports" desc="Receive periodic email summaries of scan findings" />
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20,
            opacity: config.reportConfig?.enabled ? 1 : 0.35,
            pointerEvents: config.reportConfig?.enabled ? "auto" : "none",
            transition: "opacity 0.4s ease", filter: config.reportConfig?.enabled ? "none" : "blur(1px)",
          }}>
            <div>
              <label style={labelStyle}>Frequency</label>
              <select style={selectStyle} value={config.reportConfig?.frequency ?? "weekly"}
                onChange={e => updateField(c => ({ ...c, reportConfig: { ...c.reportConfig!, frequency: e.target.value as any } }))}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>How often reports are generated and sent</div>
            </div>
            <div>
              <label style={labelStyle}>Recipients</label>
              <input style={inputStyle} value={(config.reportConfig?.recipients ?? []).join(", ")}
                onChange={e => updateField(c => ({ ...c, reportConfig: { ...c.reportConfig!, recipients: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } }))}
                placeholder="team@example.com, admin@example.com" {...focusHandlers} />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Comma-separated email addresses</div>
            </div>
          </div>
        </div>

        {/* 6. Danger Zone */}
        <div className="glass-card" style={{ padding: "28px 32px", border: "1px solid rgba(239,68,68,0.2)" }}>
          {sectionHeader("⚠️", "Danger Zone", "Destructive actions — proceed with caution", "linear-gradient(135deg, #ef4444, #dc2626)")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {/* Export Settings */}
            <div style={{ padding: "20px", borderRadius: 12, border: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 20 }}>📦</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Export Settings</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Download all settings as JSON</div>
                </div>
              </div>
              <button onClick={handleExportSettings} style={{
                width: "100%", padding: "10px", fontSize: 12, fontWeight: 700, borderRadius: 8,
                background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)",
                color: "var(--accent-light)", cursor: "pointer", transition: "all 0.2s ease",
              }}>📥 Export JSON</button>
            </div>

            {/* Reset Settings */}
            <div style={{ padding: "20px", borderRadius: 12, border: "1px solid rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 20 }}>🔄</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Reset Preferences</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Restore all app settings to defaults</div>
                </div>
              </div>
              {dangerConfirm === "reset" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={handleResetSettings} disabled={dangerLoading} style={{
                    flex: 1, padding: "10px", fontSize: 12, fontWeight: 700, borderRadius: 8,
                    background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)",
                    color: "#f59e0b", cursor: "pointer",
                  }}>{dangerLoading ? "Resetting..." : "Confirm"}</button>
                  <button onClick={() => setDangerConfirm(null)} style={{
                    flex: 1, padding: "10px", fontSize: 12, fontWeight: 600, borderRadius: 8,
                    background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)",
                    color: "var(--text-muted)", cursor: "pointer",
                  }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setDangerConfirm("reset")} style={{
                  width: "100%", padding: "10px", fontSize: 12, fontWeight: 700, borderRadius: 8,
                  background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
                  color: "#f59e0b", cursor: "pointer", transition: "all 0.2s ease",
                }}>🔄 Reset to Defaults</button>
              )}
            </div>

            {/* Clear Scan History */}
            <div style={{ padding: "20px", borderRadius: 12, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 20 }}>🗑️</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Clear Scan History</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Remove all stored scan data</div>
                </div>
              </div>
              {dangerConfirm === "clear" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={handleClearHistory} disabled={dangerLoading} style={{
                    flex: 1, padding: "10px", fontSize: 12, fontWeight: 700, borderRadius: 8,
                    background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)",
                    color: "#ef4444", cursor: "pointer",
                  }}>{dangerLoading ? "Clearing..." : "Confirm"}</button>
                  <button onClick={() => setDangerConfirm(null)} style={{
                    flex: 1, padding: "10px", fontSize: 12, fontWeight: 600, borderRadius: 8,
                    background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)",
                    color: "var(--text-muted)", cursor: "pointer",
                  }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setDangerConfirm("clear")} style={{
                  width: "100%", padding: "10px", fontSize: 12, fontWeight: 700, borderRadius: 8,
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                  color: "#ef4444", cursor: "pointer", transition: "all 0.2s ease",
                }}>🗑️ Clear History</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
