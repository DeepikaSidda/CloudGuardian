import { GovernanceDataRepository } from "../repository";

const repo = new GovernanceDataRepository();

export interface FailScanInput {
  scanId: string;
  error: string;
}

export async function handler(event: FailScanInput): Promise<void> {
  await repo.updateScanStatus(event.scanId, "FAILED", {
    endTime: new Date().toISOString(),
    errors: [
      {
        accountId: "N/A",
        region: "N/A",
        errorCode: "SCAN_FAILED",
        errorMessage: event.error,
      },
    ],
  });
}
