import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { GovernanceDataRepository } from "./repository";
import type { Recommendation, ScanRecord } from "@governance-engine/shared";

const repo = new GovernanceDataRepository();
const ses = new SESClient({});
const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });

const SES_SENDER = process.env.SES_SENDER_EMAIL ?? "governance@example.com";
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "";

interface DigestInput {
  scanId: string;
}

export async function handler(event: DigestInput): Promise<void> {
  console.log("Email digest triggered for scan:", event.scanId);

  // Get config to check if reports are enabled and get recipients
  const config = await repo.getConfig();
  if (!config?.reportConfig?.enabled) {
    console.log("Reports disabled, skipping email digest");
    return;
  }
  const recipients = config.reportConfig.recipients ?? [];
  if (recipients.length === 0) {
    console.log("No recipients configured, skipping email digest");
    return;
  }

  // Get current scan's recommendations
  const currentRecs = await repo.queryRecommendationsByScan(event.scanId);
  console.log(`Current scan has ${currentRecs.length} recommendations`);

  // Find previous completed scan
  const allScans = await repo.listScans();
  const completedScans = allScans
    .filter((s: ScanRecord) => s.status === "COMPLETED" && s.scanId !== event.scanId)
    .sort((a: ScanRecord, b: ScanRecord) => (b.startTime > a.startTime ? 1 : -1));

  let newFindings: Recommendation[] = [];
  let resolvedCount = 0;

  if (completedScans.length > 0) {
    const prevScan = completedScans[0];
    const prevRecs = await repo.queryRecommendationsByScan(prevScan.scanId);
    console.log(`Previous scan (${prevScan.scanId}) had ${prevRecs.length} recommendations`);

    // Build a set of resource IDs from previous scan for quick lookup
    const prevResourceKeys = new Set(
      prevRecs.map((r: Recommendation) => `${r.resourceId}|${r.advisorType}|${r.issueDescription}`)
    );
    const currResourceKeys = new Set(
      currentRecs.map((r: Recommendation) => `${r.resourceId}|${r.advisorType}|${r.issueDescription}`)
    );

    // New findings = in current but not in previous
    newFindings = currentRecs.filter(
      (r: Recommendation) => !prevResourceKeys.has(`${r.resourceId}|${r.advisorType}|${r.issueDescription}`)
    );

    // Resolved = in previous but not in current
    resolvedCount = prevRecs.filter(
      (r: Recommendation) => !currResourceKeys.has(`${r.resourceId}|${r.advisorType}|${r.issueDescription}`)
    ).length;
  } else {
    // First scan ever — all findings are new
    newFindings = currentRecs;
  }

  console.log(`New findings: ${newFindings.length}, Resolved: ${resolvedCount}`);

  if (newFindings.length === 0 && resolvedCount === 0) {
    console.log("No changes since last scan, skipping email");
    return;
  }

  // Generate AI summary using Bedrock Nova Lite
  const aiSummary = await generateAISummary(newFindings, resolvedCount, currentRecs.length);

  // Build and send the email
  const html = buildEmailHtml(newFindings, resolvedCount, currentRecs.length, aiSummary);
  await sendEmail(recipients, html, newFindings.length);
  console.log("Digest email sent successfully");
}

async function generateAISummary(
  newFindings: Recommendation[],
  resolvedCount: number,
  totalCount: number
): Promise<string> {
  const findingSummaries = newFindings.slice(0, 15).map((r) =>
    `- ${r.resourceType} "${r.resourceId}" in ${r.region}: ${r.issueDescription} (Risk: ${r.riskLevel}${r.estimatedMonthlySavings ? `, ~$${r.estimatedMonthlySavings.toFixed(2)}/mo` : ""})`
  ).join("\n");

  const totalSavings = newFindings.reduce((sum, r) => sum + (r.estimatedMonthlySavings ?? 0), 0);

  const prompt = `You are CloudGuardian, an AI cloud advisor. Write a brief, friendly email digest summarizing new findings from the latest AWS governance scan.

Stats:
- ${newFindings.length} NEW findings detected
- ${resolvedCount} previously flagged issues are now resolved
- ${totalCount} total active findings
- Estimated new monthly waste: $${totalSavings.toFixed(2)}

New findings:
${findingSummaries || "None"}

Write 2-3 short paragraphs in a warm, professional tone. Highlight the most critical items. If there are cost savings opportunities, mention the total. If issues were resolved, congratulate the team. Keep it under 150 words. Do NOT use markdown — use plain text only.`;

  try {
    const response = await bedrock.send(new ConverseCommand({
      modelId: "amazon.nova-lite-v1:0",
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 512, temperature: 0.4 },
    }));
    return response.output?.message?.content?.[0]?.text ?? "Scan complete. Review your dashboard for details.";
  } catch (err: any) {
    console.error("Bedrock AI summary failed:", err.message);
    return `Your latest scan found ${newFindings.length} new finding(s) and ${resolvedCount} resolved issue(s). Visit your CloudGuardian dashboard for full details.`;
  }
}

async function sendEmail(recipients: string[], html: string, newCount: number): Promise<void> {
  const subject = newCount > 0
    ? `☁️ CloudGuardian: ${newCount} new finding${newCount > 1 ? "s" : ""} detected`
    : `☁️ CloudGuardian: Scan complete — issues resolved!`;

  await ses.send(new SendEmailCommand({
    Source: SES_SENDER,
    Destination: { ToAddresses: recipients },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html } },
    },
  }));
}

function buildEmailHtml(
  newFindings: Recommendation[],
  resolvedCount: number,
  totalCount: number,
  aiSummary: string
): string {
  const totalSavings = newFindings.reduce((sum, r) => sum + (r.estimatedMonthlySavings ?? 0), 0);
  const highCount = newFindings.filter(r => r.riskLevel === "High").length;
  const medCount = newFindings.filter(r => r.riskLevel === "Medium").length;
  const lowCount = newFindings.filter(r => r.riskLevel === "Low").length;
  const scanTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const findingRows = newFindings.slice(0, 20).map(r => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #1e293b;color:#f1f5f9;font-size:13px">${r.resourceType}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${r.resourceId}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #1e293b;font-size:13px">
        <span style="padding:3px 10px;border-radius:20px;font-weight:600;font-size:11px;${
          r.riskLevel === "High" ? "background:#dc262620;color:#f87171" :
          r.riskLevel === "Medium" ? "background:#f59e0b20;color:#fbbf24" :
          "background:#22c55e20;color:#4ade80"
        }">${r.riskLevel}</span>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:12px">${r.issueDescription}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #1e293b;color:#4ade80;font-size:13px;font-weight:600">${r.estimatedMonthlySavings ? `$${r.estimatedMonthlySavings.toFixed(2)}` : "—"}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0b1120;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:700px;margin:0 auto;padding:32px 20px">

  <!-- Header -->
  <div style="text-align:center;padding:32px 0 24px">
    <div style="font-size:28px;font-weight:800;color:#f1f5f9;letter-spacing:-0.02em">&#9729;&#65039; CloudGuardian</div>
    <div style="color:#64748b;font-size:13px;margin-top:4px">Scan Digest &middot; ${scanTime} IST</div>
  </div>

  <!-- KPI Cards -->
  <div style="display:flex;gap:12px;margin-bottom:24px">
    <div style="flex:1;background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:12px;padding:18px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:#60a5fa">${newFindings.length}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px">New Findings</div>
    </div>
    <div style="flex:1;background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:12px;padding:18px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:#4ade80">${resolvedCount}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px">Resolved</div>
    </div>
    <div style="flex:1;background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:12px;padding:18px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:#f1f5f9">${totalCount}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px">Total Active</div>
    </div>
    <div style="flex:1;background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:12px;padding:18px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:#fbbf24">$${totalSavings.toFixed(0)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px">Potential Savings/mo</div>
    </div>
  </div>

  <!-- Risk Breakdown -->
  ${(highCount + medCount + lowCount) > 0 ? `
  <div style="display:flex;gap:8px;margin-bottom:24px">
    ${highCount > 0 ? `<div style="flex:1;background:#dc262615;border:1px solid #dc262640;border-radius:10px;padding:12px;text-align:center">
      <span style="font-size:18px;font-weight:700;color:#f87171">${highCount}</span>
      <span style="font-size:12px;color:#f87171;margin-left:6px">High Risk</span>
    </div>` : ""}
    ${medCount > 0 ? `<div style="flex:1;background:#f59e0b15;border:1px solid #f59e0b40;border-radius:10px;padding:12px;text-align:center">
      <span style="font-size:18px;font-weight:700;color:#fbbf24">${medCount}</span>
      <span style="font-size:12px;color:#fbbf24;margin-left:6px">Medium</span>
    </div>` : ""}
    ${lowCount > 0 ? `<div style="flex:1;background:#22c55e15;border:1px solid #22c55e40;border-radius:10px;padding:12px;text-align:center">
      <span style="font-size:18px;font-weight:700;color:#4ade80">${lowCount}</span>
      <span style="font-size:12px;color:#4ade80;margin-left:6px">Low</span>
    </div>` : ""}
  </div>` : ""}

  <!-- AI Summary -->
  <div style="background:linear-gradient(135deg,#1e1b4b,#172554);border:1px solid #4338ca40;border-radius:14px;padding:24px;margin-bottom:24px">
    <div style="font-size:14px;font-weight:700;color:#a78bfa;margin-bottom:12px">&#129302; AI Analysis</div>
    <div style="color:#cbd5e1;font-size:13px;line-height:1.7">${aiSummary.replace(/\n/g, "<br>")}</div>
  </div>

  <!-- New Findings Table -->
  ${newFindings.length > 0 ? `
  <div style="background:#0f172a;border:1px solid #1e293b;border-radius:14px;overflow:hidden;margin-bottom:24px">
    <div style="padding:18px 20px;border-bottom:1px solid #1e293b">
      <span style="font-size:15px;font-weight:700;color:#f1f5f9">&#128270; New Findings</span>
      <span style="font-size:12px;color:#64748b;margin-left:8px">(${newFindings.length})</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <tr style="background:#1e293b40">
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Type</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Resource</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Risk</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Issue</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Savings</th>
      </tr>
      ${findingRows}
    </table>
    ${newFindings.length > 20 ? `<div style="padding:12px 20px;color:#64748b;font-size:12px;text-align:center;border-top:1px solid #1e293b">...and ${newFindings.length - 20} more findings</div>` : ""}
  </div>` : ""}

  <!-- CTA Button -->
  <div style="text-align:center;margin:32px 0">
    <a href="${DASHBOARD_URL}" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;font-size:14px;font-weight:700;border-radius:10px;text-decoration:none">View Full Dashboard &rarr;</a>
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:24px 0;border-top:1px solid #1e293b">
    <div style="color:#475569;font-size:11px">CloudGuardian &middot; Keep Your Cloud Clean</div>
    <div style="color:#334155;font-size:10px;margin-top:4px">This is an automated scan digest. Configure in Settings.</div>
  </div>

</div>
</body></html>`;
}
