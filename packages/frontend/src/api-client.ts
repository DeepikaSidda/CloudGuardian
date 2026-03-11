import type {
  ScanRecord,
  Recommendation,
  ResourceAction,
  GovernanceConfig,
  AdvisorType,
  RiskLevel,
  ResourceType,
  DependencyGraphResponse,
  GovernancePolicy,
} from "@governance-engine/shared";

const API_URL = "https://t1t7s9jm71.execute-api.us-east-1.amazonaws.com/prod";

const getBaseUrl = (): string => {
  // When running on localhost (Vite dev server), use the /api proxy to avoid CORS issues
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "/api";
  }
  return (typeof window !== "undefined" && (window as any).__API_URL__) || API_URL;
};

// In-memory cache for GET requests to avoid redundant Lambda cold-start hits
const apiCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30_000; // 30 seconds

function getCached<T>(key: string): T | null {
  const entry = apiCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data as T;
  if (entry) apiCache.delete(key);
  return null;
}

function setCache(key: string, data: unknown) {
  apiCache.set(key, { data, ts: Date.now() });
}

/** Clear all cached API responses (call after mutations) */
export function invalidateCache() {
  apiCache.clear();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const cacheKey = path;

  // Only cache GET requests
  if (method === "GET") {
    const cached = getCached<T>(cacheKey);
    if (cached !== null) return cached;
  }

  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body}`);
  }
  const data = await res.json() as T;

  // Cache GET responses
  if (method === "GET") setCache(cacheKey, data);

  // Invalidate cache on mutations
  if (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH") {
    invalidateCache();
  }

  return data;
}

// --- Scans ---

export function getScans(accountId?: string): Promise<ScanRecord[]> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return request(`/scans${qs}`);
}

export function getScan(scanId: string): Promise<ScanRecord> {
  return request(`/scans/${encodeURIComponent(scanId)}`);
}

export function triggerScan(): Promise<{ scanId: string }> {
  return request("/scans", { method: "POST" });
}

export function clearScanHistory(): Promise<{ message: string }> {
  return request("/scans", { method: "DELETE" });
}

// --- Recommendations ---

export interface RecommendationFilters {
  advisorType?: AdvisorType;
  riskLevel?: RiskLevel;
  region?: string;
  resourceType?: ResourceType;
  accountId?: string;
  scanId?: string;
}

export function getRecommendations(
  filters?: RecommendationFilters,
): Promise<Recommendation[]> {
  const params = new URLSearchParams();
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined) params.set(k, v);
    }
  }
  const qs = params.toString();
  return request(`/recommendations${qs ? `?${qs}` : ""}`);
}

export function getRecommendation(id: string, scanId?: string): Promise<Recommendation> {
  const qs = scanId ? `?scanId=${encodeURIComponent(scanId)}` : "";
  return request(`/recommendations/${encodeURIComponent(id)}${qs}`);
}

// --- Actions ---

export interface InitiateActionInput {
  recommendationId: string;
  actionType: string;
  dependencyAcknowledgment?: boolean;
}

export function initiateAction(
  input: InitiateActionInput,
): Promise<ResourceAction> {
  return request("/actions", { method: "POST", body: JSON.stringify(input) });
}

export function getActions(): Promise<ResourceAction[]> {
  return request("/actions");
}

// --- Summary & Trends ---

export interface DashboardSummary {
  countsByAdvisor: Record<string, number>;
  countsByRiskLevel: Record<string, number>;
  totalCostSavings: number;
  costByAdvisor: Record<string, number>;
  lastScanTimestamp?: string | null;
  totalResourcesEvaluated: number;
  perAccount?: Record<string, { count: number; savings: number }>;
  accountInfo?: { accountId: string; accountName: string } | null;
}

export function getSummary(accountId?: string): Promise<DashboardSummary> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return request(`/summary${qs}`);
}

export interface TrendEntry {
  scanId: string;
  startTime: string;
  recommendationCount: number;
}

export function getTrends(accountId?: string): Promise<TrendEntry[]> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return request(`/trends${qs}`);
}

// --- Config ---

export function getConfig(): Promise<GovernanceConfig> {
  return request("/config");
}

export function updateConfig(
  config: GovernanceConfig,
): Promise<GovernanceConfig> {
  return request("/config", { method: "PUT", body: JSON.stringify(config) });
}

// --- Active Services ---

export interface ServiceResource {
  name: string;
  id: string;
  status?: string;
  details?: string;
  estimatedMonthlyCost?: number;
  createdAt?: string;
  stale?: boolean;
  staleDays?: number;
}

export interface ActiveService {
  serviceName: string;
  icon: string;
  count: number;
  resources: ServiceResource[];
  estimatedMonthlyCost?: number;
}

export interface ServiceCategory {
  category: string;
  icon: string;
  services: ActiveService[];
  estimatedMonthlyCost?: number;
}

export function getActiveServices(region?: string, accountId?: string): Promise<ServiceCategory[]> {
  const params = new URLSearchParams();
  if (region) params.set("region", region);
  if (accountId) params.set("accountId", accountId);
  const qs = params.toString();
  return request(`/active-services${qs ? `?${qs}` : ""}`);
}

export function getActiveServicesMultiRegion(regions: string[]): Promise<Record<string, ServiceCategory[]>> {
  return request(`/active-services?regions=${regions.join(",")}`);
}

// --- AI Recommendations ---

export function getAIRecommendation(recommendation: any): Promise<{ aiRecommendation: string }> {
  return request("/ai-recommend", { method: "POST", body: JSON.stringify({ recommendation }) });
}

// --- Resource Control ---

export interface ResourceControlInput {
  service: string;
  action: string;
  resourceId: string;
  region: string;
}

export interface ResourceControlOutput {
  success: boolean;
  message: string;
  service: string;
  action: string;
  resourceId: string;
}

export function controlResource(input: ResourceControlInput): Promise<ResourceControlOutput> {
  return request("/resource-control", { method: "POST", body: JSON.stringify(input) });
}

// --- Cost Anomalies ---

export interface CostAnomaly {
  resourceType: string;
  previousCount: number;
  currentCount: number;
  change: number;
  percentChange: number;
  severity: string;
}

export interface CostResource {
  resourceId: string;
  resourceType: string;
  riskLevel: string;
  issueDescription: string;
  estimatedMonthlySavings: number | null;
  advisorType?: string;
  region?: string;
}

export interface ResourceBreakdown {
  resourceType: string;
  previous: number;
  current: number;
  change: number;
  costPrev: number;
  costCurr: number;
}

export interface CostAnomalyResponse {
  anomalies: CostAnomaly[];
  latestScan: string;
  previousScan: string;
  latestTime: string;
  previousTime: string;
  totalLatest: number;
  totalPrevious: number;
  message?: string;
  riskComparison?: { latest: Record<string, number>; previous: Record<string, number> };
  advisorComparison?: { latest: Record<string, number>; previous: Record<string, number> };
  savingsComparison?: { latest: number; previous: number; delta: number };
  topCostResources?: CostResource[];
  newResources?: CostResource[];
  resolvedResources?: CostResource[];
  resourceBreakdown?: ResourceBreakdown[];
}

export function getCostAnomalies(accountId?: string): Promise<CostAnomalyResponse> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return request(`/cost-anomalies${qs}`);
}

// --- Billing & Forecast ---

export interface BillingData {
  currentMonthCost: number;
  projectedTotal: number;
  previousMonthCost: number;
  monthOverMonthChange: number;
  forecastRemaining: number | null;
  forecastLow: number | null;
  forecastHigh: number | null;
  serviceBreakdown: { service: string; amount: number }[];
  monthlyHistory: { month: string; amount: number }[];
  dailyCosts: { date: string; amount: number }[];
  aiInsight: string | null;
  currentMonth: string;
  daysElapsed: number;
  daysInMonth: number;
}

export function getBilling(): Promise<BillingData> {
  return request("/cost-anomalies?type=billing");
}

// --- Polling helper ---

export function createPoller(
  callback: () => void,
  intervalMs: number = 30_000,
): { start: () => void; stop: () => void; setInterval: (ms: number) => void } {
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentInterval = intervalMs;

  return {
    start() {
      this.stop();
      timer = setInterval(callback, currentInterval);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    setInterval(ms: number) {
      currentInterval = ms;
      if (timer !== null) {
        this.start(); // restart with new interval
      }
    },
  };
}

// --- AI Assistant ---

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantAttachment {
  type: "image" | "video" | "document";
  format: string;
  data: string; // base64
  name?: string;
}

export interface AssistantResponse {
  reply: string;
  action?: string;
  actionResult?: string;
}

export function sendAssistantMessage(
  message: string,
  history: AssistantMessage[] = [],
  attachments: AssistantAttachment[] = [],
): Promise<AssistantResponse> {
  return request("/assistant", {
    method: "POST",
    body: JSON.stringify({ message, history, attachments }),
  });
}

// --- Settings (DynamoDB-backed key-value store) ---

export function getSetting<T = unknown>(key: string): Promise<{ key: string; value: T | null }> {
  return request(`/settings/${encodeURIComponent(key)}`);
}

export function putSetting<T = unknown>(key: string, value: T): Promise<{ success: boolean }> {
  return request(`/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

export function deleteSetting(key: string): Promise<{ success: boolean }> {
  return request(`/settings/${encodeURIComponent(key)}`, { method: "DELETE" });
}

// --- Chat Sessions (DynamoDB-backed) ---

export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatSessionFull {
  id: string;
  title: string;
  messages: { role: "user" | "assistant"; content: string; timestamp: string; attachments?: { type: string; format: string; name: string }[] }[];
  createdAt: string;
  updatedAt: string;
}

export function listChats(): Promise<ChatSessionSummary[]> {
  return request("/chats");
}

export function getChat(chatId: string): Promise<ChatSessionFull> {
  return request(`/chats/${chatId}`);
}

export function saveChat(session: ChatSessionFull): Promise<{ success: boolean }> {
  return request("/chats", {
    method: "POST",
    body: JSON.stringify(session),
  });
}

export function deleteChat(chatId: string): Promise<{ success: boolean }> {
  return request(`/chats/${chatId}`, { method: "DELETE" });
}

// --- Dependency Graph ---

export function getDependencyGraph(accountId?: string): Promise<DependencyGraphResponse> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return request<DependencyGraphResponse>(`/dependency-graph${qs}`);
}

export function getDependencySubgraph(resourceId: string): Promise<DependencyGraphResponse> {
  return request<DependencyGraphResponse>(`/dependency-graph?resourceId=${encodeURIComponent(resourceId)}`);
}

// --- Governance Policies ---

export function getPolicies(): Promise<GovernancePolicy[]> {
  return request("/policies");
}

export function getPolicy(policyId: string): Promise<GovernancePolicy> {
  return request(`/policies/${encodeURIComponent(policyId)}`);
}

export function createPolicy(policy: Omit<GovernancePolicy, 'policyId' | 'createdAt' | 'updatedAt'>): Promise<GovernancePolicy> {
  return request("/policies", { method: "POST", body: JSON.stringify(policy) });
}

export function updatePolicy(policyId: string, policy: Partial<GovernancePolicy>): Promise<GovernancePolicy> {
  return request(`/policies/${encodeURIComponent(policyId)}`, { method: "PUT", body: JSON.stringify(policy) });
}

export function deletePolicy(policyId: string): Promise<{ message: string }> {
  return request(`/policies/${encodeURIComponent(policyId)}`, { method: "DELETE" });
}
