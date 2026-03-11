import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
  type Expression,
} from "@aws-sdk/client-cost-explorer";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { GovernanceDataRepository } from "../repository";

const ce = new CostExplorerClient({});
const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });
const repository = new GovernanceDataRepository();

// Cache billing data for 6 hours in DynamoDB to survive Lambda cold starts
// Cost Explorer charges $0.01 per API call — this prevents runaway charges
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getBillingData() {
  // Check DynamoDB cache first (persists across Lambda cold starts)
  try {
    const cached = await repository.getBillingCache();
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  } catch (e: any) {
    console.error("Billing cache read error:", e.message);
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  // Current month start/end
  const monthStart = fmt(new Date(y, m, 1));
  // Cost Explorer End date is EXCLUSIVE — use tomorrow to include today's data
  const tomorrow = fmt(new Date(y, m, now.getDate() + 1));

  // Last 6 months for history
  const histStart = fmt(new Date(y, m - 6, 1));

  // Filter out credits/refunds so we see gross usage (matches AWS Billing console)
  const excludeCredits: Expression = {
    Not: {
      Dimensions: {
        Key: "RECORD_TYPE",
        Values: ["Credit", "Refund", "Enterprise Discount Program Discount", "Private Rate Card Discount", "Bundled Discount"],
      },
    },
  };

  // 1) Current month-to-date cost
  let currentMonthCost = 0;
  let serviceBreakdown: { service: string; amount: number }[] = [];
  try {
    const mtd = await ce.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: monthStart, End: tomorrow },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
      Filter: excludeCredits,
    }));
    for (const group of mtd.ResultsByTime?.[0]?.Groups ?? []) {
      const svc = group.Keys?.[0] ?? "Other";
      const amt = parseFloat(group.Metrics?.UnblendedCost?.Amount ?? "0");
      if (amt > 0) {
        serviceBreakdown.push({ service: svc, amount: Math.round(amt * 100) / 100 });
        currentMonthCost += amt;
      }
    }
    serviceBreakdown.sort((a, b) => b.amount - a.amount);
    currentMonthCost = Math.round(currentMonthCost * 100) / 100;
  } catch (e: any) {
    console.error("MTD cost error:", e.message);
  }

  // 2) Last 6 months history (monthly totals)
  let monthlyHistory: { month: string; amount: number }[] = [];
  try {
    const hist = await ce.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: histStart, End: tomorrow },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      Filter: excludeCredits,
    }));
    for (const period of hist.ResultsByTime ?? []) {
      const start = period.TimePeriod?.Start ?? "";
      const amt = parseFloat(period.Total?.UnblendedCost?.Amount ?? "0");
      monthlyHistory.push({
        month: start.slice(0, 7),
        amount: Math.round(amt * 100) / 100,
      });
    }
  } catch (e: any) {
    console.error("History error:", e.message);
  }

  // 3) Daily costs for current month
  let dailyCosts: { date: string; amount: number }[] = [];
  try {
    const daily = await ce.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: monthStart, End: tomorrow },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost"],
      Filter: excludeCredits,
    }));
    for (const period of daily.ResultsByTime ?? []) {
      dailyCosts.push({
        date: period.TimePeriod?.Start ?? "",
        amount: Math.round(parseFloat(period.Total?.UnblendedCost?.Amount ?? "0") * 100) / 100,
      });
    }
  } catch (e: any) {
    console.error("Daily cost error:", e.message);
  }

  // 4) AWS Cost Forecast for rest of month
  let forecastAmount: number | null = null;
  let forecastLow: number | null = null;
  let forecastHigh: number | null = null;
  const monthEnd = fmt(new Date(y, m + 1, 1));
  try {
    const fc = await ce.send(new GetCostForecastCommand({
      TimePeriod: { Start: tomorrow, End: monthEnd },
      Metric: "UNBLENDED_COST",
      Granularity: "MONTHLY",
      PredictionIntervalLevel: 80,
    }));
    forecastAmount = Math.round(parseFloat(fc.Total?.Amount ?? "0") * 100) / 100;
    forecastLow = Math.round(parseFloat(fc.ForecastResultsByTime?.[0]?.MeanValue ?? "0") * 100) / 100;
    forecastHigh = forecastAmount;
    if (fc.ForecastResultsByTime?.[0]?.PredictionIntervalLowerBound) {
      forecastLow = Math.round(parseFloat(fc.ForecastResultsByTime[0].PredictionIntervalLowerBound) * 100) / 100;
    }
    if (fc.ForecastResultsByTime?.[0]?.PredictionIntervalUpperBound) {
      forecastHigh = Math.round(parseFloat(fc.ForecastResultsByTime[0].PredictionIntervalUpperBound) * 100) / 100;
    }
  } catch (e: any) {
    console.error("Forecast error:", e.message);
  }

  // 5) AI forecast analysis using Bedrock
  let aiInsight: string | null = null;
  try {
    const prompt = `You are a cloud cost analyst. Analyze this AWS billing data and provide a brief 2-3 sentence insight about spending trends and a prediction.

Current month-to-date: $${currentMonthCost}
Monthly history: ${monthlyHistory.map(h => `${h.month}: $${h.amount}`).join(", ")}
Top services: ${serviceBreakdown.slice(0, 5).map(s => `${s.service}: $${s.amount}`).join(", ")}
AWS forecast for remaining month: ${forecastAmount !== null ? `$${forecastAmount}` : "unavailable"}

Provide a concise insight about the trend and what to expect. Be specific with numbers.`;

    const resp = await bedrock.send(new ConverseCommand({
      modelId: "amazon.nova-lite-v1:0",
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 200, temperature: 0.3 },
    }));
    aiInsight = (resp.output as any)?.message?.content?.[0]?.text ?? null;
  } catch (e: any) {
    console.error("AI insight error:", e.message);
  }

  // Previous month total for comparison
  const prevMonth = monthlyHistory.length >= 2 ? monthlyHistory[monthlyHistory.length - 2]?.amount ?? 0 : 0;
  const projectedTotal = currentMonthCost + (forecastAmount ?? 0);

  const result = {
    currentMonthCost,
    projectedTotal: Math.round(projectedTotal * 100) / 100,
    previousMonthCost: prevMonth,
    monthOverMonthChange: prevMonth > 0 ? Math.round(((projectedTotal - prevMonth) / prevMonth) * 100) : 0,
    forecastRemaining: forecastAmount,
    forecastLow,
    forecastHigh,
    serviceBreakdown: serviceBreakdown.slice(0, 15),
    monthlyHistory,
    dailyCosts,
    aiInsight,
    currentMonth: monthStart.slice(0, 7),
    daysElapsed: now.getDate(),
    daysInMonth: new Date(y, m + 1, 0).getDate(),
  };

  // Cache the result in DynamoDB (persists across cold starts)
  try {
    await repository.putBillingCache(result);
  } catch (e: any) {
    console.error("Billing cache write error:", e.message);
  }

  return result;
}
