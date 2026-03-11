import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, ListAccountAliasesCommand } from "@aws-sdk/client-iam";
import {
  validateGovernanceConfig,
  type GovernanceConfig,
  type Recommendation,
  type ScanRecord,
  type ResourceAction,
  type GraphResourceType,
} from "@governance-engine/shared";
import { GovernanceDataRepository } from "../repository";
import { ActionExecutor } from "../action-executor";
import { discoverActiveServices } from "./active-services";
import { generateAIRecommendation } from "./ai-advisor";
import { executeResourceControl } from "./resource-control";
import { handleAssistant } from "./assistant";
import { getBillingData } from "./billing";
import {
  handleCreatePolicy,
  handleListPolicies,
  handleGetPolicy,
  handleUpdatePolicy,
  handleDeletePolicy,
} from "./policy-handlers";

const repository = new GovernanceDataRepository();
const actionExecutor = new ActionExecutor(repository);
const sfnClient = new SFNClient({});
const stsClient = new STSClient({});
const iamClient = new IAMClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN ?? "";

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key",
};

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const resource = event.resource;

  try {
    // Handle CORS preflight
    if (method === "OPTIONS") {
      return { statusCode: 200, headers: CORS_HEADERS, body: "" };
    }

    // --- Scans ---
    if (resource === "/scans" && method === "GET") {
      return handleListScans(event);
    }
    if (resource === "/scans/{scanId}" && method === "GET") {
      return handleGetScan(event.pathParameters?.scanId);
    }
    if (resource === "/scans" && method === "DELETE") {
      return handleClearScans();
    }
    if (resource === "/scans" && method === "POST") {
      return handleTriggerScan(event);
    }

    // --- Recommendations ---
    if (resource === "/recommendations" && method === "GET") {
      return handleListRecommendations(event);
    }
    if (resource === "/recommendations/{id}" && method === "GET") {
      return handleGetRecommendation(event);
    }

    // --- Actions ---
    if (resource === "/actions" && method === "POST") {
      return handleInitiateAction(event);
    }
    if (resource === "/actions" && method === "GET") {
      return handleListActions(event);
    }

    // --- Summary & Trends ---
    if (resource === "/summary" && method === "GET") {
      return handleGetSummary(event);
    }
    if (resource === "/trends" && method === "GET") {
      return handleGetTrends(event);
    }

    // --- Config ---
    if (resource === "/config" && method === "GET") {
      return handleGetConfig();
    }
    if (resource === "/config" && method === "PUT") {
      return handleUpdateConfig(event);
    }

    // --- Active Services ---
    if (resource === "/active-services" && method === "GET") {
      return handleActiveServices(event);
    }

    // --- AI Recommendation ---
    if (resource === "/ai-recommend" && method === "POST") {
      return handleAIRecommend(event);
    }

    // --- Cost Anomalies ---
    if (resource === "/cost-anomalies" && method === "GET") {
      const qType = event.queryStringParameters?.type;
      if (qType === "billing") {
        const data = await getBillingData();
        return jsonResponse(200, data);
      }
      return handleCostAnomalies(event);
    }

    // --- Resource Control ---
    if (resource === "/resource-control" && method === "POST") {
      return handleResourceControl(event);
    }

    // --- AI Assistant ---
    if (resource === "/assistant" && method === "POST") {
      const body = JSON.parse(event.body ?? "{}");
      const result = await handleAssistant(body);
      return jsonResponse(200, result);
    }

    // --- Settings (key-value store) ---
    if (resource === "/settings/{key}" && method === "GET") {
      return handleGetSetting(event.pathParameters?.key);
    }
    if (resource === "/settings/{key}" && method === "PUT") {
      return handlePutSetting(event);
    }
    if (resource === "/settings/{key}" && method === "DELETE") {
      return handleDeleteSetting(event.pathParameters?.key);
    }

    // --- Chat Sessions ---
    if (resource === "/chats" && method === "GET") {
      return handleListChats();
    }
    if (resource === "/chats" && method === "POST") {
      return handleSaveChat(event);
    }
    if (resource === "/chats/{chatId}" && method === "GET") {
      return handleGetChat(event.pathParameters?.chatId);
    }
    if (resource === "/chats/{chatId}" && method === "DELETE") {
      return handleDeleteChat(event.pathParameters?.chatId);
    }

    // --- Dependency Graph ---
    if (resource === "/dependency-graph" && method === "GET") {
      return handleGetDependencyGraph(event);
    }

    // --- Policies ---
    if (resource === "/policies" && method === "POST") {
      return handleCreatePolicy(event);
    }
    if (resource === "/policies" && method === "GET") {
      return handleListPolicies();
    }
    if (resource === "/policies/{policyId}" && method === "GET") {
      return handleGetPolicy(event.pathParameters?.policyId!);
    }
    if (resource === "/policies/{policyId}" && method === "PUT") {
      return handleUpdatePolicy(event, event.pathParameters?.policyId!);
    }
    if (resource === "/policies/{policyId}" && method === "DELETE") {
      return handleDeletePolicy(event.pathParameters?.policyId!);
    }

    return jsonResponse(404, { message: "Not found" });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("Unhandled error:", error);
    return jsonResponse(500, { message: error.message ?? "Internal server error" });
  }
}

// --- Scan Handlers ---

async function handleListScans(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const accountId = event.queryStringParameters?.accountId;
  let scans = await repository.listScans();
  if (accountId) {
    // Filter scans that include this account (scans store accountIds array or we filter by recommendations)
    // For now, return all scans — per-account filtering happens at the recommendation level
  }

  // Apply scan history limit from app_settings
  try {
    const settings = await repository.getSetting("app_settings") as any;
    const limit = settings?.scanHistoryLimit;
    if (limit && limit > 0) {
      scans = scans
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
        .slice(0, limit);
    }
  } catch { /* ignore */ }

  return jsonResponse(200, scans);
}

async function handleGetScan(scanId?: string): Promise<APIGatewayProxyResult> {
  if (!scanId) {
    return jsonResponse(400, { message: "Missing scanId path parameter" });
  }
  const scan = await repository.getScanRecord(scanId);
  if (!scan) {
    return jsonResponse(404, { message: `Scan ${scanId} not found` });
  }
  return jsonResponse(200, scan);
}

async function handleClearScans(): Promise<APIGatewayProxyResult> {
  const scans = await repository.listScans();
  for (const scan of scans) {
    await repository.deleteScanAndRecommendations(scan.scanId);
  }
  return jsonResponse(200, { message: `Deleted ${scans.length} scan(s)` });
}

async function handleTriggerScan(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = event.body ? JSON.parse(event.body) : {};
  const scanId = `scan-${Date.now()}`;

  await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: scanId,
      input: JSON.stringify(body),
    })
  );

  return jsonResponse(202, { message: "Scan triggered", scanId });
}


// --- Recommendation Handlers ---

async function handleListRecommendations(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters ?? {};
  const { advisorType, riskLevel, region, resourceType, accountId, scanId } = params;

  let recommendations: Recommendation[] = [];

  // Helper: find the latest completed scan ID with recommendations
  const getLatestScanId = async (): Promise<string | undefined> => {
    const scans = await repository.listScans();
    const completedScans = scans
      .filter(s => s.status === "COMPLETED")
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    for (const scan of completedScans) {
      const recs = await repository.queryRecommendationsByScan(scan.scanId);
      if (recs.length > 0) return scan.scanId;
    }
    return undefined;
  };

  // Use the most specific query available, then filter the rest in-memory
  if (scanId) {
    recommendations = await repository.queryRecommendationsByScan(scanId);
  } else if (advisorType) {
    // GSI returns across all scans — restrict to latest scan
    const latestScanId = await getLatestScanId();
    if (latestScanId) {
      recommendations = await repository.queryRecommendationsByScan(latestScanId);
    }
  } else if (accountId) {
    const latestScanId = await getLatestScanId();
    if (latestScanId) {
      recommendations = await repository.queryRecommendationsByScan(latestScanId);
    }
  } else if (riskLevel) {
    const latestScanId = await getLatestScanId();
    if (latestScanId) {
      recommendations = await repository.queryRecommendationsByScan(latestScanId);
    }
  } else {
    // No primary filter — use the latest completed scan
    const latestScanId = await getLatestScanId();
    if (latestScanId) {
      recommendations = await repository.queryRecommendationsByScan(latestScanId);
    }
  }

  // Apply all filters in-memory (some may already be satisfied by the primary query)
  if (advisorType) {
    recommendations = recommendations.filter((r) => r.advisorType === advisorType);
  }
  if (riskLevel) {
    recommendations = recommendations.filter((r) => r.riskLevel === riskLevel);
  }
  if (region) {
    recommendations = recommendations.filter((r) => r.region === region);
  }
  if (resourceType) {
    recommendations = recommendations.filter((r) => r.resourceType === resourceType);
  }
  if (accountId) {
    recommendations = recommendations.filter((r) => r.accountId === accountId);
  }

  return jsonResponse(200, recommendations);
}


async function handleGetRecommendation(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const id = event.pathParameters?.id;
  const scanId = event.queryStringParameters?.scanId;

  if (!id) {
    return jsonResponse(400, { message: "Missing recommendation id path parameter" });
  }
  if (!scanId) {
    return jsonResponse(400, { message: "Missing scanId query parameter" });
  }

  const rec = await repository.getRecommendation(scanId, id);
  if (!rec) {
    return jsonResponse(404, { message: `Recommendation ${id} not found` });
  }
  return jsonResponse(200, rec);
}

// --- Action Handlers ---

async function handleInitiateAction(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return jsonResponse(400, { message: "Missing request body" });
  }

  const input = JSON.parse(event.body);
  const result = await actionExecutor.execute(input);
  const statusCode = result.status === "SUCCESS" ? 200 : 400;
  return jsonResponse(statusCode, result);
}

async function handleListActions(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = event.queryStringParameters?.userId;

  if (userId) {
    const actions = await repository.queryActionsByUser(userId);
    return jsonResponse(200, actions);
  }

  const actions = await repository.listActions();
  return jsonResponse(200, actions);
}

// --- Config Handlers ---

async function handleGetConfig(): Promise<APIGatewayProxyResult> {
  const config = await repository.getConfig();
  if (!config) {
    // Return sensible defaults when no config exists yet
    const defaultConfig: GovernanceConfig = {
      scanSchedule: "cron(0 2 * * ? *)",
      scanMode: "single-account",
      lookbackPeriods: {
        safeCleanupAdvisor: 90,
        permissionDriftDetector: 90,
        zombieResourceDetector: 90,
      },
      regions: ["us-east-1"],
      reportConfig: {
        enabled: false,
        frequency: "weekly",
        recipients: [],
      },
      crossAccountRoleName: "GovernanceEngineReadOnlyRole",
    };
    return jsonResponse(200, defaultConfig);
  }
  return jsonResponse(200, config);
}

async function handleUpdateConfig(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return jsonResponse(400, { message: "Missing request body" });
  }

  const config: GovernanceConfig = JSON.parse(event.body);
  const validation = validateGovernanceConfig(config);

  if (!validation.valid) {
    return jsonResponse(400, { message: "Invalid configuration", errors: validation.errors });
  }

  await repository.putConfig(config);
  return jsonResponse(200, config);
}

// --- Summary & Trends Handlers (Task 10.2) ---

async function handleGetSummary(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const filterAccountId = event.queryStringParameters?.accountId;
  const scans = await repository.listScans();
  const completedScans = scans
    .filter((s) => s.status === "COMPLETED")
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  // Use the latest completed scan that actually has recommendations in DynamoDB
  const latestScan = completedScans[0];
  let allRecs: Recommendation[] = [];
  for (const scan of completedScans) {
    const recs = await repository.queryRecommendationsByScan(scan.scanId);
    if (recs.length > 0) {
      allRecs.push(...recs);
      break;
    }
  }

  // Filter by accountId if specified
  if (filterAccountId) {
    allRecs = allRecs.filter(r => r.accountId === filterAccountId);
  }

  // Counts by advisor type
  const countsByAdvisor: Record<string, number> = {
    SafeCleanupAdvisor: 0,
    PermissionDriftDetector: 0,
    ZombieResourceDetector: 0,
  };
  for (const rec of allRecs) {
    countsByAdvisor[rec.advisorType] = (countsByAdvisor[rec.advisorType] ?? 0) + 1;
  }

  // Counts by risk level
  const countsByRiskLevel: Record<string, number> = { Low: 0, Medium: 0, High: 0 };
  for (const rec of allRecs) {
    countsByRiskLevel[rec.riskLevel] = (countsByRiskLevel[rec.riskLevel] ?? 0) + 1;
  }

  // Total cost savings (sum of non-null estimatedMonthlySavings)
  let totalCostSavings = 0;
  for (const rec of allRecs) {
    if (rec.estimatedMonthlySavings != null) {
      totalCostSavings += rec.estimatedMonthlySavings;
    }
  }

  // Cost by advisor
  const costByAdvisor: Record<string, number> = {
    SafeCleanupAdvisor: 0,
    PermissionDriftDetector: 0,
    ZombieResourceDetector: 0,
  };
  for (const rec of allRecs) {
    if (rec.estimatedMonthlySavings != null) {
      costByAdvisor[rec.advisorType] = (costByAdvisor[rec.advisorType] ?? 0) + rec.estimatedMonthlySavings;
    }
  }

  // Last scan timestamp
  const lastScan = completedScans.sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  )[0];
  const lastScanTimestamp = lastScan?.startTime ?? null;

  // Total resources evaluated (from latest completed scan)
  const totalResourcesEvaluated = latestScan?.resourcesEvaluated ?? 0;

  // Per-account breakdown (for organization mode)
  const perAccount: Record<string, { recommendationCount: number; costSavings: number }> = {};
  for (const rec of allRecs) {
    if (!perAccount[rec.accountId]) {
      perAccount[rec.accountId] = { recommendationCount: 0, costSavings: 0 };
    }
    perAccount[rec.accountId].recommendationCount += 1;
    if (rec.estimatedMonthlySavings != null) {
      perAccount[rec.accountId].costSavings += rec.estimatedMonthlySavings;
    }
  }

  // Get caller identity for account info
  let accountInfo: { accountId: string; accountName: string } | null = null;
  try {
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));
    const accountId = identity.Account ?? "";
    // Try to get account alias (friendly name set in IAM console)
    let accountName = accountId;
    try {
      const aliases = await iamClient.send(new ListAccountAliasesCommand({}));
      if (aliases.AccountAliases && aliases.AccountAliases.length > 0) {
        accountName = aliases.AccountAliases[0];
      }
    } catch { /* no alias set, use account ID */ }
    accountInfo = { accountId, accountName };
  } catch { /* ignore */ }

  return jsonResponse(200, {
    countsByAdvisor,
    countsByRiskLevel,
    totalCostSavings,
    costByAdvisor,
    lastScanTimestamp,
    totalResourcesEvaluated,
    perAccount,
    accountInfo,
  });
}

async function handleGetTrends(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const filterAccountId = event.queryStringParameters?.accountId;
  let scans = await repository.listScans();

  // Apply scan history limit from app_settings
  try {
    const settings = await repository.getSetting("app_settings") as any;
    const limit = settings?.scanHistoryLimit;
    if (limit && limit > 0) {
      scans = scans
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
        .slice(0, limit);
    }
  } catch { /* ignore */ }

  // Sort chronologically (oldest first), take last 10 completed scans
  const sorted = scans
    .filter((s): s is ScanRecord & { startTime: string } => !!s.startTime && s.status === "COMPLETED")
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const last10 = sorted.slice(-10);

  // Backfill recommendation counts for scans that have 0 (older scans before aggregation fix)
  const trends = await Promise.all(last10.map(async (scan) => {
    let count = scan.recommendationCount;
    if (count === 0 || filterAccountId) {
      try {
        const recs = await repository.queryRecommendationsByScan(scan.scanId);
        const filtered = filterAccountId ? recs.filter(r => r.accountId === filterAccountId) : recs;
        count = filtered.length;
        // Update the scan record so future queries don't need to backfill (only if no filter)
        if (!filterAccountId && count > 0 && scan.recommendationCount === 0) {
          await repository.updateScanStatus(scan.scanId, scan.status, { recommendationCount: count });
        }
      } catch { /* ignore */ }
    }
    return {
      scanId: scan.scanId,
      startTime: scan.startTime,
      recommendationCount: count,
    };
  }));

  return jsonResponse(200, trends);
}

// In-memory cache for active services (live AWS calls are expensive)
const activeServicesCache = new Map<string, { data: any; ts: number }>();
const ACTIVE_SERVICES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function handleActiveServices(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const region = event.queryStringParameters?.region ?? "us-east-1";
  const regions = event.queryStringParameters?.regions;

  if (regions) {
    const regionList = regions.split(",").map(r => r.trim());
    const cacheKey = `multi:${regionList.sort().join(",")}`;
    const cached = activeServicesCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ACTIVE_SERVICES_CACHE_TTL) {
      return jsonResponse(200, cached.data);
    }
    const allResults: Record<string, any> = {};
    await Promise.all(regionList.map(async (r) => {
      allResults[r] = await discoverActiveServices(r);
    }));
    activeServicesCache.set(cacheKey, { data: allResults, ts: Date.now() });
    return jsonResponse(200, allResults);
  }

  const cacheKey = `single:${region}`;
  const cached = activeServicesCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ACTIVE_SERVICES_CACHE_TTL) {
    return jsonResponse(200, cached.data);
  }
  const categories = await discoverActiveServices(region);
  activeServicesCache.set(cacheKey, { data: categories, ts: Date.now() });
  return jsonResponse(200, categories);
}

async function handleAIRecommend(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) return jsonResponse(400, { message: "Missing body" });
  const { recommendation } = JSON.parse(event.body);
  if (!recommendation) return jsonResponse(400, { message: "Missing recommendation" });
  const aiText = await generateAIRecommendation(recommendation);
  return jsonResponse(200, { aiRecommendation: aiText });
}

async function handleCostAnomalies(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const filterAccountId = event.queryStringParameters?.accountId;
  const scans = await repository.listScans();
  const completed = scans.filter(s => s.status === "COMPLETED").sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  if (completed.length < 2) return jsonResponse(200, { anomalies: [], message: "Need at least 2 scans for comparison" });

  const [latest, previous] = completed;
  let latestRecs = await repository.queryRecommendationsByScan(latest.scanId);
  let prevRecs = await repository.queryRecommendationsByScan(previous.scanId);

  // Filter by accountId if specified
  if (filterAccountId) {
    latestRecs = latestRecs.filter(r => r.accountId === filterAccountId);
    prevRecs = prevRecs.filter(r => r.accountId === filterAccountId);
  }

  // Count by resource type
  const countByType = (recs: Recommendation[]) => {
    const m: Record<string, number> = {};
    for (const r of recs) m[r.resourceType] = (m[r.resourceType] ?? 0) + 1;
    return m;
  };

  const latestCounts = countByType(latestRecs);
  const prevCounts = countByType(prevRecs);

  const anomalies: { resourceType: string; previousCount: number; currentCount: number; change: number; severity: string; percentChange: number }[] = [];

  const allTypes = new Set([...Object.keys(latestCounts), ...Object.keys(prevCounts)]);
  for (const type of allTypes) {
    const curr = latestCounts[type] ?? 0;
    const prev = prevCounts[type] ?? 0;
    const change = curr - prev;
    const percentChange = prev > 0 ? Math.round((change / prev) * 100) : (curr > 0 ? 100 : 0);
    if (Math.abs(change) >= 3 || (prev > 0 && Math.abs(change / prev) > 0.5)) {
      anomalies.push({
        resourceType: type,
        previousCount: prev,
        currentCount: curr,
        change,
        percentChange,
        severity: Math.abs(change) >= 10 ? "High" : Math.abs(change) >= 5 ? "Medium" : "Low",
      });
    }
  }

  // Risk level distribution comparison
  const riskByLevel = (recs: Recommendation[]) => {
    const m: Record<string, number> = { High: 0, Medium: 0, Low: 0 };
    for (const r of recs) m[r.riskLevel] = (m[r.riskLevel] ?? 0) + 1;
    return m;
  };
  const latestRisk = riskByLevel(latestRecs);
  const prevRisk = riskByLevel(prevRecs);

  // Advisor type breakdown comparison
  const byAdvisor = (recs: Recommendation[]) => {
    const m: Record<string, number> = {};
    for (const r of recs) m[r.advisorType] = (m[r.advisorType] ?? 0) + 1;
    return m;
  };
  const latestAdvisor = byAdvisor(latestRecs);
  const prevAdvisor = byAdvisor(prevRecs);

  // Cost savings comparison
  const costByType = (recs: Recommendation[]) => {
    const m: Record<string, number> = {};
    for (const r of recs) {
      if (r.estimatedMonthlySavings != null) {
        m[r.resourceType] = (m[r.resourceType] ?? 0) + r.estimatedMonthlySavings;
      }
    }
    return m;
  };
  const latestCost = costByType(latestRecs);
  const prevCost = costByType(prevRecs);
  const totalLatestSavings = Object.values(latestCost).reduce((a, b) => a + b, 0);
  const totalPrevSavings = Object.values(prevCost).reduce((a, b) => a + b, 0);

  // Top cost-impacting resources from latest scan
  const topCostResources = latestRecs
    .filter(r => r.estimatedMonthlySavings != null && r.estimatedMonthlySavings > 0)
    .sort((a, b) => (b.estimatedMonthlySavings ?? 0) - (a.estimatedMonthlySavings ?? 0))
    .slice(0, 10)
    .map(r => ({
      resourceId: r.resourceId,
      resourceType: r.resourceType,
      riskLevel: r.riskLevel,
      estimatedMonthlySavings: r.estimatedMonthlySavings,
      issueDescription: r.issueDescription,
      advisorType: r.advisorType,
      region: r.region,
    }));

  // New resources (in latest but not in previous)
  const prevIds = new Set(prevRecs.map(r => r.resourceId));
  const newResources = latestRecs.filter(r => !prevIds.has(r.resourceId)).map(r => ({
    resourceId: r.resourceId,
    resourceType: r.resourceType,
    riskLevel: r.riskLevel,
    issueDescription: r.issueDescription,
    estimatedMonthlySavings: r.estimatedMonthlySavings,
  }));

  // Resolved resources (in previous but not in latest)
  const latestIds = new Set(latestRecs.map(r => r.resourceId));
  const resolvedResources = prevRecs.filter(r => !latestIds.has(r.resourceId)).map(r => ({
    resourceId: r.resourceId,
    resourceType: r.resourceType,
    riskLevel: r.riskLevel,
    issueDescription: r.issueDescription,
    estimatedMonthlySavings: r.estimatedMonthlySavings,
  }));

  // Resource type full breakdown (all types, not just anomalies)
  const resourceBreakdown: { resourceType: string; previous: number; current: number; change: number; costPrev: number; costCurr: number }[] = [];
  for (const type of allTypes) {
    resourceBreakdown.push({
      resourceType: type,
      previous: prevCounts[type] ?? 0,
      current: latestCounts[type] ?? 0,
      change: (latestCounts[type] ?? 0) - (prevCounts[type] ?? 0),
      costPrev: prevCost[type] ?? 0,
      costCurr: latestCost[type] ?? 0,
    });
  }

  return jsonResponse(200, {
    anomalies: anomalies.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
    latestScan: latest.scanId,
    previousScan: previous.scanId,
    latestTime: latest.startTime,
    previousTime: previous.startTime,
    totalLatest: latestRecs.length,
    totalPrevious: prevRecs.length,
    riskComparison: { latest: latestRisk, previous: prevRisk },
    advisorComparison: { latest: latestAdvisor, previous: prevAdvisor },
    savingsComparison: { latest: totalLatestSavings, previous: totalPrevSavings, delta: totalLatestSavings - totalPrevSavings },
    topCostResources,
    newResources: newResources.slice(0, 20),
    resolvedResources: resolvedResources.slice(0, 20),
    resourceBreakdown: resourceBreakdown.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
  });
}


async function handleResourceControl(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) return jsonResponse(400, { message: "Missing body" });
  const { service, action, resourceId, region } = JSON.parse(event.body);
  if (!service || !action || !resourceId || !region) {
    return jsonResponse(400, { message: "Missing required fields: service, action, resourceId, region" });
  }
  const result = await executeResourceControl({ service, action, resourceId, region });

  // Log the action to DynamoDB
  try {
    // Map frontend service names to ResourceType
    const serviceToType: Record<string, string> = {
      "EC2 Instances": "EC2Instance", "Lambda Functions": "LambdaFunction",
      "S3 Buckets": "S3Bucket", "EBS Volumes": "EBSVolume",
      "Elastic IPs": "ElasticIP", "Security Groups": "SecurityGroup",
      "CloudWatch Log Groups": "CloudWatchLogGroup",
      "IAM Roles": "IAMRole", "IAM Users": "IAMUser",
    };
    const actionRecord: ResourceAction = {
      actionId: `rc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      recommendationId: "resource-control",
      userId: "dashboard-user",
      accountId: "current",
      region,
      resourceId,
      resourceType: (serviceToType[service] ?? service) as any,
      actionType: action as any,
      status: result.success ? "SUCCESS" : "FAILED",
      initiatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      result: result.message,
    };
    await repository.putAction(actionRecord);
  } catch { /* don't fail the response if logging fails */ }

  return jsonResponse(result.success ? 200 : 400, result);
}

// --- Settings Handlers (key-value store) ---

async function handleGetSetting(key?: string): Promise<APIGatewayProxyResult> {
  if (!key) return jsonResponse(400, { message: "key is required" });
  const value = await repository.getSetting(key);
  if (value === undefined) return jsonResponse(200, { key, value: null });
  return jsonResponse(200, { key, value });
}

async function handlePutSetting(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const key = event.pathParameters?.key;
  if (!key) return jsonResponse(400, { message: "key is required" });
  if (!event.body) return jsonResponse(400, { message: "Missing body" });
  const body = JSON.parse(event.body);
  await repository.putSetting(key, body.value);
  return jsonResponse(200, { success: true });
}

async function handleDeleteSetting(key?: string): Promise<APIGatewayProxyResult> {
  if (!key) return jsonResponse(400, { message: "key is required" });
  await repository.deleteSetting(key);
  return jsonResponse(200, { success: true });
}

// --- Chat Session Handlers ---

async function handleListChats(): Promise<APIGatewayProxyResult> {
  const chats = await repository.listChatSessions();
  // Return only metadata (no messages) for the list view
  const summaries = chats.map((c: any) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c.messages?.length ?? 0,
  }));
  summaries.sort((a: any, b: any) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return jsonResponse(200, summaries);
}

async function handleGetChat(chatId?: string): Promise<APIGatewayProxyResult> {
  if (!chatId) return jsonResponse(400, { message: "chatId is required" });
  const chat = await repository.getChatSession(chatId);
  if (!chat) return jsonResponse(404, { message: "Chat not found" });
  return jsonResponse(200, chat);
}

async function handleSaveChat(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) return jsonResponse(400, { message: "Missing body" });
  const body = JSON.parse(event.body);
  if (!body.id || !body.title || !body.messages) {
    return jsonResponse(400, { message: "Missing required fields: id, title, messages" });
  }
  await repository.putChatSession({
    id: body.id,
    title: body.title,
    messages: body.messages,
    createdAt: body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return jsonResponse(200, { success: true });
}

async function handleDeleteChat(chatId?: string): Promise<APIGatewayProxyResult> {
  if (!chatId) return jsonResponse(400, { message: "chatId is required" });
  await repository.deleteChatSession(chatId);
  return jsonResponse(200, { success: true });
}

// --- Valid GraphResourceType values for validation ---
const VALID_GRAPH_RESOURCE_TYPES: GraphResourceType[] = [
  "EC2Instance", "EBSVolume", "ElasticIP", "LoadBalancer", "SecurityGroup",
  "IAMUser", "IAMRole", "LambdaFunction", "RDSInstance", "ECSService",
  "NATGateway", "CloudWatchLogGroup", "VPC", "Subnet", "SubnetGroup",
  "TargetGroup", "ECSCluster",
];

// --- Dependency Graph Handler ---

async function handleGetDependencyGraph(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters ?? {};
  const resourceId = params.resourceId;
  const resourceType = params.resourceType;
  const filterAccountId = params.accountId;
  const region = params.region ?? process.env.AWS_REGION ?? "us-east-1";

  // Validate resourceType if provided
  if (resourceType && !VALID_GRAPH_RESOURCE_TYPES.includes(resourceType as GraphResourceType)) {
    return jsonResponse(400, {
      message: `Invalid resourceType: ${resourceType}. Valid values: ${VALID_GRAPH_RESOURCE_TYPES.join(", ")}`,
    });
  }

  // Determine which account ID to look up graph data for
  const lookupAccountId = filterAccountId || (() => { /* will use STS below */ return null; })();

  // Get current account ID (for fallback)
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));
  const accountId = filterAccountId || identity.Account || "";

  // Find the latest graph scan — try real account ID first, then "self" (single-account mode)
  let scanId = await repository.getLatestGraphScanId(accountId, region);
  if (!scanId) {
    scanId = await repository.getLatestGraphScanId("self", region);
  }
  if (!scanId) {
    return jsonResponse(200, { scanId: "", nodes: [], edges: [] });
  }

  // Fetch graph data
  let graph;
  if (resourceId) {
    graph = await repository.getSubgraph(scanId, resourceId, 2);
  } else {
    graph = await repository.getGraph(scanId);
  }

  let { nodes, edges } = graph;

  // Filter by resourceType if provided
  if (resourceType) {
    nodes = nodes.filter((n) => n.resourceType === resourceType);
    const nodeIds = new Set(nodes.map((n) => n.resourceId));
    edges = edges.filter(
      (e) => nodeIds.has(e.sourceResourceId) || nodeIds.has(e.targetResourceId)
    );
  }

  return jsonResponse(200, { scanId, nodes, edges });
}
