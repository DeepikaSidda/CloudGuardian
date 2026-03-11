import { GovernanceDataRepository } from "../repository";

const repo = new GovernanceDataRepository();

interface RegionResult {
  resourcesEvaluated: number;
  recommendationCount: number;
}

export interface CompleteScanInput {
  scanId: string;
  mapResults?: RegionResult[][];
  resourcesEvaluated?: number;
  recommendationCount?: number;
}

export async function handler(event: CompleteScanInput): Promise<void> {
  let resourcesEvaluated = event.resourcesEvaluated ?? 0;
  let recommendationCount = event.recommendationCount ?? 0;

  // Aggregate from nested map results (accounts × regions)
  if (event.mapResults) {
    for (const accountResults of event.mapResults) {
      if (Array.isArray(accountResults)) {
        for (const regionResult of accountResults) {
          resourcesEvaluated += regionResult?.resourcesEvaluated ?? 0;
          recommendationCount += regionResult?.recommendationCount ?? 0;
        }
      }
    }
  }

  // If counts are still 0, query DynamoDB directly for actual recommendation count
  if (recommendationCount === 0) {
    try {
      const recs = await repo.queryRecommendationsByScan(event.scanId);
      recommendationCount = recs.length;
      if (resourcesEvaluated === 0) {
        resourcesEvaluated = recs.length;
      }
    } catch { /* ignore */ }
  }

  await repo.updateScanStatus(event.scanId, "COMPLETED", {
    endTime: new Date().toISOString(),
    resourcesEvaluated,
    recommendationCount,
  });

  // Auto-cleanup: remove old scans if enabled in app_settings
  try {
    const settings = await repo.getSetting("app_settings") as any;
    if (settings?.autoCleanupEnabled && settings?.autoCleanupDays > 0) {
      const cutoff = Date.now() - settings.autoCleanupDays * 24 * 60 * 60 * 1000;
      const allScans = await repo.listScans();
      const oldScans = allScans.filter(
        (s) => s.scanId !== event.scanId && new Date(s.startTime).getTime() < cutoff
      );
      for (const old of oldScans) {
        await repo.deleteScanAndRecommendations(old.scanId);
      }
      if (oldScans.length > 0) {
        console.log(`Auto-cleanup: removed ${oldScans.length} scan(s) older than ${settings.autoCleanupDays} days`);
      }
    }
  } catch (err) {
    console.error("Auto-cleanup error:", err);
  }
}
