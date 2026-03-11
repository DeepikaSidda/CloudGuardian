import { GovernanceDataRepository } from "../repository";
import type { ScanRecord, GovernanceConfig } from "@governance-engine/shared";

const repo = new GovernanceDataRepository();

export interface StartScanOutput {
  scanId: string;
  scanMode: GovernanceConfig["scanMode"];
  regions: string[];
  lookbackPeriods: GovernanceConfig["lookbackPeriods"];
  crossAccountRoleName: string;
  accountFilter?: GovernanceConfig["organizationConfig"];
}

export async function handler(): Promise<StartScanOutput> {
  // Check for in-progress scans — auto-expire if stuck > 30 min
  const inProgress = await repo.getInProgressScan();
  if (inProgress) {
    const startedAt = new Date(inProgress.startTime).getTime();
    const stuckThresholdMs = 30 * 60 * 1000;
    if (Date.now() - startedAt > stuckThresholdMs) {
      // Auto-fail the stuck scan
      await repo.putScanRecord({
        ...inProgress,
        status: "FAILED",
        endTime: new Date().toISOString(),
        errors: [...(inProgress.errors ?? []), { accountId: "system", region: "global", errorCode: "TIMEOUT", errorMessage: "Auto-expired: scan exceeded 30 minute timeout" }],
      });
    } else {
      throw new Error(
        `A scan is already in progress (scanId: ${inProgress.scanId}). Please wait for it to complete before starting a new scan.`
      );
    }
  }

  // Read config
  const config = await repo.getConfig();
  const scanMode = config?.scanMode ?? "single-account";
  const regions = config?.regions?.length ? config.regions : [process.env.AWS_REGION ?? "us-east-1"];
  const lookbackPeriods = config?.lookbackPeriods ?? {
    safeCleanupAdvisor: 90,
    permissionDriftDetector: 90,
    zombieResourceDetector: 90,
  };
  const crossAccountRoleName =
    config?.crossAccountRoleName ?? "GovernanceEngineReadOnlyRole";

  const scanId = crypto.randomUUID();
  const now = new Date().toISOString();

  const scanRecord: ScanRecord = {
    scanId,
    status: "IN_PROGRESS",
    scanMode,
    startTime: now,
    resourcesEvaluated: 0,
    recommendationCount: 0,
    accountsScanned: [],
    regionsScanned: [],
    errors: [],
  };

  await repo.putScanRecord(scanRecord);

  return {
    scanId,
    scanMode,
    regions,
    lookbackPeriods,
    crossAccountRoleName,
    accountFilter: config?.organizationConfig ?? undefined,
  };
}
