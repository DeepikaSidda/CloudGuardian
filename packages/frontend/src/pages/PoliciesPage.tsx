import { useState, useEffect } from "react";
import { getPolicies, createPolicy, updatePolicy, deletePolicy } from "../api-client";
import type { GovernancePolicy } from "@governance-engine/shared";
import LoadingSpinner from "../components/LoadingSpinner";

const RESOURCE_PROPERTY_MAP: Record<string, string[]> = {
  EC2Instance: ["InstanceType", "State", "PublicIpAddress", "Tags", "VpcId", "SubnetId", "ImageId", "LaunchTime"],
  EBSVolume: ["VolumeType", "Size", "State", "Encrypted", "Iops"],
  S3Bucket: ["BucketName", "VersioningEnabled", "PublicAccessBlocked", "EncryptionEnabled", "Tags"],
  SecurityGroup: ["GroupName", "VpcId", "InboundRuleCount", "OutboundRuleCount", "Tags"],
  IAMUser: ["UserName", "MfaEnabled", "AccessKeyAge", "PasswordLastUsed", "Tags"],
  IAMRole: ["RoleName", "LastUsedDate", "AttachedPolicyCount", "Tags"],
  LambdaFunction: ["Runtime", "MemorySize", "Timeout", "CodeSize", "LastModified", "Tags"],
  RDSInstance: ["DBInstanceClass", "Engine", "MultiAZ", "StorageEncrypted", "PubliclyAccessible", "Tags"],
  LoadBalancer: ["Type", "Scheme", "State", "Tags"],
  VPC: ["CidrBlock", "State", "IsDefault", "Tags"],
  Subnet: ["CidrBlock", "AvailabilityZone", "MapPublicIpOnLaunch", "State", "VpcId", "Tags"],
  ElasticIP: ["PublicIp", "Associated", "AllocationId", "Tags"],
  SNSTopic: ["TopicName", "SubscriptionCount", "KmsMasterKeyId", "Tags"],
  SQSQueue: ["QueueName", "VisibilityTimeout", "MessageRetentionPeriod", "EncryptionEnabled", "Tags"],
  DynamoDBTable: ["TableName", "TableStatus", "BillingMode", "ItemCount", "TableSizeBytes", "Tags"],
  CloudFrontDistribution: ["DomainName", "Status", "Enabled", "HttpVersion", "PriceClass"],
  ECSCluster: ["ClusterName", "Status", "RunningTasksCount", "ActiveServicesCount", "Tags"],
  AutoScalingGroup: ["AutoScalingGroupName", "MinSize", "MaxSize", "DesiredCapacity", "HealthCheckType", "Tags"],
};

const RESOURCE_TYPES = Object.keys(RESOURCE_PROPERTY_MAP);

const OPERATORS = [
  "equals", "not_equals", "greater_than", "less_than",
  "in", "not_in", "contains", "not_contains", "exists", "not_exists",
];

const SEVERITIES = ["Low", "Medium", "High"];

const SEVERITY_COLORS: Record<string, string> = { High: "var(--red)", Medium: "var(--orange)", Low: "var(--yellow)" };

const RESOURCE_ICONS: Record<string, string> = {
  EC2Instance: "🖥️", EBSVolume: "💾", S3Bucket: "🪣", SecurityGroup: "🛡️",
  IAMUser: "👤", IAMRole: "🔑", LambdaFunction: "⚡", RDSInstance: "🗄️",
  LoadBalancer: "⚖️", VPC: "🌐", Subnet: "📡", ElasticIP: "📌",
  SNSTopic: "📢", SQSQueue: "📬", DynamoDBTable: "📊", CloudFrontDistribution: "🌍",
  ECSCluster: "🐳", AutoScalingGroup: "📈",
};

interface PolicyForm {
  name: string;
  description: string;
  resourceType: string;
  severity: string;
  conditionProperty: string;
  conditionOperator: string;
  conditionValue: string;
}

const emptyForm: PolicyForm = {
  name: "",
  description: "",
  resourceType: RESOURCE_TYPES[0],
  severity: "Medium",
  conditionProperty: RESOURCE_PROPERTY_MAP[RESOURCE_TYPES[0]][0],
  conditionOperator: "equals",
  conditionValue: "",
};

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<GovernancePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<PolicyForm>({ ...emptyForm });
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [toast, setToast] = useState<{ m: string; ok: boolean } | null>(null);
  const [showTips, setShowTips] = useState(false);

  const load = () => {
    setLoading(true);
    getPolicies()
      .then((p) => { setPolicies(p); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); } }, [toast]);

  const availableProperties = RESOURCE_PROPERTY_MAP[form.resourceType] || [];

  const handleResourceTypeChange = (rt: string) => {
    const props = RESOURCE_PROPERTY_MAP[rt] || [];
    setForm((f) => ({ ...f, resourceType: rt, conditionProperty: props[0] || "" }));
  };

  const parseConditionValue = (val: string, operator: string): unknown => {
    if (operator === "exists" || operator === "not_exists") return undefined;
    if (operator === "in" || operator === "not_in") {
      try { return JSON.parse(val); } catch { return val.split(",").map((s) => s.trim()); }
    }
    if (operator === "greater_than" || operator === "less_than") {
      const n = Number(val);
      return isNaN(n) ? val : n;
    }
    if (val === "true") return true;
    if (val === "false") return false;
    const n = Number(val);
    return isNaN(n) ? val : n;
  };

  const handleSubmit = async () => {
    setFormErrors([]);
    setSubmitting(true);
    try {
      const conditionValue = parseConditionValue(form.conditionValue, form.conditionOperator);
      const body: any = {
        name: form.name,
        description: form.description,
        resourceType: form.resourceType,
        severity: form.severity,
        enabled: true,
        condition: {
          property: form.conditionProperty,
          operator: form.conditionOperator,
          ...(conditionValue !== undefined ? { value: conditionValue } : {}),
        },
      };
      const created = await createPolicy(body);
      setPolicies((prev) => [...prev, created]);
      setShowForm(false);
      setForm({ ...emptyForm });
      setToast({ m: `Policy "${created.name}" created`, ok: true });
    } catch (e: any) {
      try {
        const parsed = JSON.parse(e.message.replace(/^API \d+: /, ""));
        if (parsed.errors) { setFormErrors(parsed.errors); } else { setFormErrors([e.message]); }
      } catch { setFormErrors([e.message]); }
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (policy: GovernancePolicy) => {
    try {
      const updated = await updatePolicy(policy.policyId, { enabled: !policy.enabled });
      setPolicies((prev) => prev.map((p) => (p.policyId === policy.policyId ? updated : p)));
    } catch (e: any) {
      setToast({ m: e.message, ok: false });
    }
  };

  const handleDelete = async (policyId: string) => {
    try {
      await deletePolicy(policyId);
      setPolicies((prev) => prev.filter((p) => p.policyId !== policyId));
      setDeleteConfirm(null);
      setToast({ m: "Policy deleted", ok: true });
    } catch (e: any) {
      setToast({ m: e.message, ok: false });
      setDeleteConfirm(null);
    }
  };

  return (
    <div className="page-enter">
      {toast && (
        <div className={"toast " + (toast.ok ? "toast-success" : "toast-error")} style={{ position: "fixed", top: 20, right: 20, zIndex: 999, animation: "fadeInUp 0.3s ease" }}>
          {toast.ok ? "✅" : "❌"} {toast.m}
        </div>
      )}

      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", animation: "fadeIn 0.2s ease" }} onClick={() => setDeleteConfirm(null)}>
          <div className="glass-card" style={{ padding: 28, maxWidth: 400, width: "90%", border: "1px solid var(--border-light)", animation: "scaleIn 0.2s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, background: "rgba(239,68,68,0.15)" }}>⚠️</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Delete Policy</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>This action cannot be undone</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => setDeleteConfirm(null)} style={{ padding: "10px 20px" }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius-md)", cursor: "pointer", border: "none", color: "#fff", background: "linear-gradient(135deg, #ef4444, #dc2626)", boxShadow: "0 2px 8px rgba(239,68,68,0.3)" }}>
                🗑️ Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>Governance Policies</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Define custom compliance rules for your AWS resources</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowTips(true)} style={{ padding: "10px 18px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius-md)", cursor: "pointer", border: "1px solid var(--border)", color: "var(--text-secondary)", background: "var(--bg-glass)", display: "flex", alignItems: "center", gap: 6 }}>
            💡 Tips
          </button>
          <button onClick={() => { setShowForm(!showForm); setFormErrors([]); setForm({ ...emptyForm }); }} style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius-md)", cursor: "pointer", border: "none", color: "#fff", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 2px 8px rgba(99,102,241,0.3)" }}>
            {showForm ? "✕ Cancel" : "＋ Create Policy"}
          </button>
        </div>
      </div>

      {showTips && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", animation: "fadeIn 0.2s ease" }} onClick={() => setShowTips(false)}>
          <div className="glass-card" style={{ padding: 28, maxWidth: 640, width: "90%", maxHeight: "80vh", overflowY: "auto", border: "1px solid var(--border-light)", animation: "scaleIn 0.2s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 24 }}>💡</span>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>Policy Tips & Examples</h2>
              </div>
              <button onClick={() => setShowTips(false)} style={{ padding: "6px 12px", fontSize: 13, borderRadius: 8, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)" }}>✕</button>
            </div>

            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 20 }}>
              Policies let you define rules that flag non-compliant resources during scans. Pick a resource type, set a condition on one of its properties, and choose a severity level.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { icon: "🔒", name: "EBS Encryption Required", type: "EBSVolume", condition: "Encrypted → equals → true", desc: "Flag all unencrypted EBS volumes as non-compliant" },
                { icon: "🚫", name: "No Large EC2 Instances", type: "EC2Instance", condition: 'InstanceType → not_in → ["t3.micro","t3.small","t3.medium"]', desc: "Block instances larger than t3.medium to control costs" },
                { icon: "🌐", name: "No Public RDS", type: "RDSInstance", condition: "PubliclyAccessible → equals → false", desc: "Ensure all RDS databases are not publicly accessible" },
                { icon: "🔐", name: "MFA Required for IAM Users", type: "IAMUser", condition: "MfaEnabled → equals → true", desc: "Flag IAM users that don't have MFA enabled" },
                { icon: "⏱️", name: "Lambda Timeout Limit", type: "LambdaFunction", condition: "Timeout → less_than → 300", desc: "Ensure Lambda functions don't exceed 5 minute timeout" },
                { icon: "🛡️", name: "RDS Encryption Required", type: "RDSInstance", condition: "StorageEncrypted → equals → true", desc: "Flag RDS instances without storage encryption" },
                { icon: "🪣", name: "S3 Public Access Blocked", type: "S3Bucket", condition: "PublicAccessBlocked → equals → true", desc: "Ensure all S3 buckets block public access" },
                { icon: "📊", name: "DynamoDB On-Demand Billing", type: "DynamoDBTable", condition: "BillingMode → equals → PAY_PER_REQUEST", desc: "Ensure tables use on-demand billing to avoid over-provisioning" },
              ].map((ex, i) => (
                <div key={i} style={{ padding: "14px 16px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>{ex.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>{ex.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{ex.desc}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(6,182,212,0.1)", color: "var(--cyan)", fontWeight: 600 }}>{ex.type}</span>
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(99,102,241,0.1)", color: "var(--accent-light)", fontFamily: "monospace" }}>{ex.condition}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20, padding: "12px 16px", borderRadius: 10, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <span style={{ fontWeight: 700, color: "var(--accent-light)" }}>Pro tip:</span> For boolean values like <code style={{ fontSize: 11, padding: "1px 4px", borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>Encrypted</code> or <code style={{ fontSize: 11, padding: "1px 4px", borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>MfaEnabled</code>, just type <code style={{ fontSize: 11, padding: "1px 4px", borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>true</code> or <code style={{ fontSize: 11, padding: "1px 4px", borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>false</code> in the value field. For lists, use JSON format like <code style={{ fontSize: 11, padding: "1px 4px", borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>["t3.micro","t3.small"]</code>.
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="glass-card" style={{ padding: 24, marginBottom: 24, animation: "fadeInUp 0.3s ease" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "var(--text-primary)" }}>New Policy</h2>
          {formErrors.length > 0 && (
            <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
              {formErrors.map((err, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--red)", marginBottom: i < formErrors.length - 1 ? 4 : 0 }}>⚠️ {err}</div>
              ))}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" }}>Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. No large EC2 instances" style={{ width: "100%", padding: "10px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" }}>Description</label>
              <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional description" style={{ width: "100%", padding: "10px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" }}>Resource Type</label>
              <select value={form.resourceType} onChange={(e) => handleResourceTypeChange(e.target.value)} style={{ width: "100%", padding: "10px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}>
                {RESOURCE_TYPES.map((rt) => <option key={rt} value={rt}>{rt}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" }}>Severity</label>
              <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))} style={{ width: "100%", padding: "10px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" }}>Condition</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <select value={form.conditionProperty} onChange={(e) => setForm((f) => ({ ...f, conditionProperty: e.target.value }))} style={{ padding: "10px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", outline: "none" }}>
                {availableProperties.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={form.conditionOperator} onChange={(e) => setForm((f) => ({ ...f, conditionOperator: e.target.value }))} style={{ padding: "10px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", outline: "none" }}>
                {OPERATORS.map((op) => <option key={op} value={op}>{op.replace(/_/g, " ")}</option>)}
              </select>
              {form.conditionOperator !== "exists" && form.conditionOperator !== "not_exists" && (
                <input type="text" value={form.conditionValue} onChange={(e) => setForm((f) => ({ ...f, conditionValue: e.target.value }))} placeholder={form.conditionOperator === "in" || form.conditionOperator === "not_in" ? '["val1","val2"]' : "value"} style={{ padding: "10px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", outline: "none" }} />
              )}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={handleSubmit} disabled={submitting} style={{ padding: "10px 24px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius-md)", cursor: "pointer", border: "none", color: "#fff", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 2px 8px rgba(99,102,241,0.3)", opacity: submitting ? 0.6 : 1 }}>
              {submitting ? "Creating..." : "Create Policy"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSpinner message="Loading governance policies..." />
      ) : error ? (
        <div className="toast toast-error">⚠️ {error}</div>
      ) : policies.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No policies yet</div>
          <div className="empty-state-desc">Create your first governance policy to start enforcing compliance rules.</div>
        </div>
      ) : (
        <>
          {/* Stats summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { icon: "📋", label: "Total Policies", value: policies.length, color: "var(--accent-light)" },
              { icon: "✅", label: "Active", value: policies.filter(p => p.enabled).length, color: "var(--green)" },
              { icon: "⏸️", label: "Disabled", value: policies.filter(p => !p.enabled).length, color: "var(--text-muted)" },
              { icon: "🔴", label: "High Severity", value: policies.filter(p => p.severity === "High").length, color: "var(--red)" },
            ].map((s, i) => (
              <div key={i} className="glass-card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{s.icon}</div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Policy cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {policies.map((p, i) => {
              const sevColor = SEVERITY_COLORS[p.severity] || "var(--text-muted)";
              const icon = RESOURCE_ICONS[p.resourceType] || "📦";
              return (
                <div key={p.policyId} className="glass-card" style={{ padding: 0, opacity: p.enabled ? 1 : 0.6, animation: `cardEntrance 0.4s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.05}s both` }}>
                  {/* Severity accent bar */}
                  <div style={{ height: 3, background: sevColor, borderRadius: "16px 16px 0 0" }} />
                  <div style={{ padding: "16px 20px" }}>
                    {/* Header row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(99,102,241,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                          {p.description && <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.description}</div>}
                        </div>
                      </div>
                      <span className={"badge badge-" + p.severity.toLowerCase()} style={{ color: sevColor, flexShrink: 0, marginLeft: 8 }}>{p.severity}</span>
                    </div>

                    {/* Condition display */}
                    <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(6,182,212,0.1)", color: "var(--cyan)", fontWeight: 600 }}>{p.resourceType}</span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>→</span>
                        <span style={{ fontSize: 11, color: "var(--accent-light)", fontFamily: "monospace", fontWeight: 500 }}>{p.condition.property}</span>
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(139,92,246,0.1)", color: "var(--purple)", fontWeight: 600 }}>{p.condition.operator.replace(/_/g, " ")}</span>
                        {p.condition.value !== undefined && (
                          <span style={{ fontSize: 11, color: "var(--text-primary)", fontFamily: "monospace", fontWeight: 600 }}>{JSON.stringify(p.condition.value)}</span>
                        )}
                      </div>
                    </div>

                    {/* Actions row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <button onClick={() => handleToggle(p)} style={{ padding: "6px 16px", fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "1px solid " + (p.enabled ? "rgba(34,197,94,0.3)" : "var(--border)"), background: p.enabled ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.03)", color: p.enabled ? "var(--green)" : "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s ease" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.enabled ? "var(--green)" : "var(--text-muted)", boxShadow: p.enabled ? "0 0 6px var(--green)" : "none" }} />
                        {p.enabled ? "Active" : "Disabled"}
                      </button>
                      <button onClick={() => setDeleteConfirm(p.policyId)} style={{ padding: "6px 14px", fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "1px solid rgba(239,68,68,0.2)", background: "transparent", color: "var(--red)", transition: "all 0.2s ease" }}>
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
