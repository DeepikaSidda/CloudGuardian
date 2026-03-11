import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { GovernanceDataRepository } from "./repository";
import type {
  Recommendation,
  ScanMode,
  AdvisorType,
  RiskLevel,
} from "@governance-engine/shared";

export interface ReportSchedulerInput {
  frequency: "daily" | "weekly" | "monthly";
  recipients: string[];
  scanMode: ScanMode;
}

interface ReportData {
  countsByAdvisor: Record<string, number>;
  countsByRisk: Record<string, number>;
  topByCostSavings: Recommendation[];
  topPermissionDrift: Recommendation[];
  totalMonthlySavings: number;
  perAccountBreakdown?: AccountBreakdown[];
  topAccountsBySavings?: AccountBreakdown[];
}

interface AccountBreakdown {
  accountId: string;
  recommendationCount: number;
  totalSavings: number;
}

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const REPORT_BUCKET = process.env.REPORT_BUCKET ?? "governance-reports";
const SES_SENDER = process.env.SES_SENDER_EMAIL ?? "governance@example.com";

export class ReportScheduler {
  private readonly repo: GovernanceDataRepository;
  private readonly ses: SESClient;
  private readonly s3: S3Client;

  constructor(
    repo?: GovernanceDataRepository,
    ses?: SESClient,
    s3?: S3Client
  ) {
    this.repo = repo ?? new GovernanceDataRepository();
    this.ses = ses ?? new SESClient({});
    this.s3 = s3 ?? new S3Client({});
  }

  async generateAndSendReport(input: ReportSchedulerInput): Promise<void> {
    const recommendations = await this.fetchLatestRecommendations();
    const reportData = this.buildReportData(recommendations, input.scanMode);
    const htmlBody = this.formatHtmlReport(reportData, input);

    await this.archiveReport(htmlBody, input);
    await this.sendEmailWithRetry(htmlBody, input);
  }

  private async fetchLatestRecommendations(): Promise<Recommendation[]> {
    const scans = await this.repo.listScans();
    const completedScans = scans
      .filter((s) => s.status === "COMPLETED")
      .sort((a, b) => (b.startTime > a.startTime ? 1 : -1));

    if (completedScans.length === 0) return [];
    return this.repo.queryRecommendationsByScan(completedScans[0].scanId);
  }

  buildReportData(
    recommendations: Recommendation[],
    scanMode: ScanMode
  ): ReportData {
    const countsByAdvisor: Record<string, number> = {};
    const countsByRisk: Record<string, number> = {};
    let totalMonthlySavings = 0;

    for (const rec of recommendations) {
      countsByAdvisor[rec.advisorType] =
        (countsByAdvisor[rec.advisorType] ?? 0) + 1;
      countsByRisk[rec.riskLevel] = (countsByRisk[rec.riskLevel] ?? 0) + 1;
      if (rec.estimatedMonthlySavings != null) {
        totalMonthlySavings += rec.estimatedMonthlySavings;
      }
    }

    const topByCostSavings = [...recommendations]
      .filter((r) => r.estimatedMonthlySavings != null)
      .sort(
        (a, b) =>
          (b.estimatedMonthlySavings ?? 0) - (a.estimatedMonthlySavings ?? 0)
      )
      .slice(0, 10);

    const topPermissionDrift = [...recommendations]
      .filter((r) => r.advisorType === "PermissionDriftDetector")
      .sort((a, b) => riskOrder(b.riskLevel) - riskOrder(a.riskLevel))
      .slice(0, 5);

    const data: ReportData = {
      countsByAdvisor,
      countsByRisk,
      topByCostSavings,
      topPermissionDrift,
      totalMonthlySavings,
    };

    if (scanMode === "organization") {
      const accountMap = new Map<string, AccountBreakdown>();
      for (const rec of recommendations) {
        const existing = accountMap.get(rec.accountId) ?? {
          accountId: rec.accountId,
          recommendationCount: 0,
          totalSavings: 0,
        };
        existing.recommendationCount += 1;
        if (rec.estimatedMonthlySavings != null) {
          existing.totalSavings += rec.estimatedMonthlySavings;
        }
        accountMap.set(rec.accountId, existing);
      }
      data.perAccountBreakdown = Array.from(accountMap.values());
      data.topAccountsBySavings = [...data.perAccountBreakdown]
        .sort((a, b) => b.totalSavings - a.totalSavings)
        .slice(0, 5);
    }

    return data;
  }

  formatHtmlReport(data: ReportData, input: ReportSchedulerInput): string {
    const lines: string[] = [];
    lines.push("<!DOCTYPE html><html><head><meta charset='utf-8'></head><body>");
    lines.push(`<h1>AWS Governance Report (${input.frequency})</h1>`);
    lines.push(`<p>Generated: ${new Date().toISOString()}</p>`);

    // Summary counts by advisor type
    lines.push("<h2>Recommendations by Advisor Type</h2><table border='1' cellpadding='4'>");
    lines.push("<tr><th>Advisor</th><th>Count</th></tr>");
    for (const [advisor, count] of Object.entries(data.countsByAdvisor)) {
      lines.push(`<tr><td>${advisor}</td><td>${count}</td></tr>`);
    }
    lines.push("</table>");

    // Summary counts by risk level
    lines.push("<h2>Recommendations by Risk Level</h2><table border='1' cellpadding='4'>");
    lines.push("<tr><th>Risk Level</th><th>Count</th></tr>");
    for (const level of ["High", "Medium", "Low"] as RiskLevel[]) {
      if (data.countsByRisk[level]) {
        lines.push(`<tr><td>${level}</td><td>${data.countsByRisk[level]}</td></tr>`);
      }
    }
    lines.push("</table>");

    // Total estimated monthly savings
    lines.push(`<h2>Total Estimated Monthly Savings</h2><p>$${data.totalMonthlySavings.toFixed(2)}</p>`);

    // Top 10 by cost savings
    lines.push("<h2>Top 10 Recommendations by Cost Savings</h2>");
    if (data.topByCostSavings.length === 0) {
      lines.push("<p>No cost savings data available.</p>");
    } else {
      lines.push("<table border='1' cellpadding='4'>");
      lines.push("<tr><th>#</th><th>Resource</th><th>Type</th><th>Savings/mo</th><th>Description</th></tr>");
      data.topByCostSavings.forEach((rec, i) => {
        lines.push(
          `<tr><td>${i + 1}</td><td>${rec.resourceId}</td><td>${rec.resourceType}</td>` +
          `<td>$${(rec.estimatedMonthlySavings ?? 0).toFixed(2)}</td><td>${rec.issueDescription}</td></tr>`
        );
      });
      lines.push("</table>");
    }

    // Top 5 highest-risk permission drift findings
    lines.push("<h2>Top 5 Highest-Risk Permission Drift Findings</h2>");
    if (data.topPermissionDrift.length === 0) {
      lines.push("<p>No permission drift findings.</p>");
    } else {
      lines.push("<table border='1' cellpadding='4'>");
      lines.push("<tr><th>#</th><th>Resource</th><th>Risk</th><th>Description</th></tr>");
      data.topPermissionDrift.forEach((rec, i) => {
        lines.push(
          `<tr><td>${i + 1}</td><td>${rec.resourceId}</td><td>${rec.riskLevel}</td>` +
          `<td>${rec.issueDescription}</td></tr>`
        );
      });
      lines.push("</table>");
    }

    // Organization mode: per-account breakdown
    if (input.scanMode === "organization" && data.perAccountBreakdown) {
      lines.push("<h2>Per-Account Breakdown</h2><table border='1' cellpadding='4'>");
      lines.push("<tr><th>Account</th><th>Recommendations</th><th>Savings/mo</th></tr>");
      for (const acct of data.perAccountBreakdown) {
        lines.push(
          `<tr><td>${acct.accountId}</td><td>${acct.recommendationCount}</td>` +
          `<td>$${acct.totalSavings.toFixed(2)}</td></tr>`
        );
      }
      lines.push("</table>");

      // Top 5 accounts by savings
      if (data.topAccountsBySavings && data.topAccountsBySavings.length > 0) {
        lines.push("<h2>Top 5 Accounts by Savings</h2><table border='1' cellpadding='4'>");
        lines.push("<tr><th>#</th><th>Account</th><th>Savings/mo</th></tr>");
        data.topAccountsBySavings.forEach((acct, i) => {
          lines.push(
            `<tr><td>${i + 1}</td><td>${acct.accountId}</td><td>$${acct.totalSavings.toFixed(2)}</td></tr>`
          );
        });
        lines.push("</table>");
      }
    }

    lines.push("</body></html>");
    return lines.join("\n");
  }

  private async sendEmailWithRetry(
    htmlBody: string,
    input: ReportSchedulerInput
  ): Promise<void> {
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      try {
        await this.ses.send(
          new SendEmailCommand({
            Source: SES_SENDER,
            Destination: { ToAddresses: input.recipients },
            Message: {
              Subject: {
                Data: `AWS Governance Report (${input.frequency}) - ${new Date().toISOString().split("T")[0]}`,
              },
              Body: { Html: { Data: htmlBody } },
            },
          })
        );
        console.log("Report email sent successfully");
        return;
      } catch (err) {
        console.error(
          `SES send attempt ${attempt + 1}/${RETRY_DELAYS_MS.length} failed:`,
          err
        );
        if (attempt < RETRY_DELAYS_MS.length - 1) {
          await sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    }
    console.error(
      "Failed to send report email after 3 attempts. Giving up."
    );
  }

  private async archiveReport(
    htmlBody: string,
    input: ReportSchedulerInput
  ): Promise<void> {
    const now = new Date();
    const key = `reports/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.toISOString()}-${input.frequency}.html`;
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: REPORT_BUCKET,
          Key: key,
          Body: htmlBody,
          ContentType: "text/html",
        })
      );
      console.log(`Report archived to s3://${REPORT_BUCKET}/${key}`);
    } catch (err) {
      console.error("Failed to archive report to S3:", err);
    }
  }
}

function riskOrder(level: RiskLevel): number {
  switch (level) {
    case "High":
      return 3;
    case "Medium":
      return 2;
    case "Low":
      return 1;
    default:
      return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Lambda handler triggered by EventBridge
const scheduler = new ReportScheduler();

export async function handler(): Promise<void> {
  const config = await new GovernanceDataRepository().getConfig();
  if (!config?.reportConfig?.enabled) {
    console.log("Reporting is disabled. Skipping.");
    return;
  }

  const input: ReportSchedulerInput = {
    frequency: config.reportConfig.frequency,
    recipients: config.reportConfig.recipients,
    scanMode: config.scanMode,
  };

  if (input.recipients.length === 0) {
    console.log("No recipients configured. Skipping report.");
    return;
  }

  await scheduler.generateAndSendReport(input);
}
