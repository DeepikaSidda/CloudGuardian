import { GovernanceDataRepository } from "../repository";
import { SafeCleanupAdvisor } from "../advisors/safe-cleanup-advisor";
import { PermissionDriftDetector } from "../advisors/permission-drift-detector";
import { ZombieResourceDetector } from "../advisors/zombie-resource-detector";
import { DependencyGraphBuilder } from "../dependency-graph/builder";
import { GovernancePolicyEngine } from "../advisors/governance-policy-engine";
import type { LookbackConfig, ScanError } from "@governance-engine/shared";

const repo = new GovernanceDataRepository();

export interface InvokeAdvisorsInput {
  scanId: string;
  accountId: string;
  region: string;
  lookbackPeriods: LookbackConfig;
  crossAccountRoleName: string;
}

export interface InvokeAdvisorsOutput {
  resourcesEvaluated: number;
  recommendationCount: number;
  errors: ScanError[];
}

export async function handler(
  event: InvokeAdvisorsInput
): Promise<InvokeAdvisorsOutput> {
  const { scanId, accountId, region, lookbackPeriods, crossAccountRoleName } =
    event;

  // For extra accounts, check if there's a per-account role ARN override in settings
  let crossAccountRoleArn: string | undefined;
  if (accountId !== "self") {
    try {
      const setting = await repo.getSetting("extra_accounts");
      if (setting && Array.isArray(setting)) {
        const match = (setting as { accountId: string; roleArn?: string }[]).find(
          (a) => a.accountId === accountId
        );
        if (match?.roleArn) {
          crossAccountRoleArn = match.roleArn;
        }
      }
    } catch { /* ignore */ }

    // Fall back to default role name if no per-account override
    if (!crossAccountRoleArn) {
      crossAccountRoleArn = `arn:aws:iam::${accountId}:role/${crossAccountRoleName}`;
    }
  }

  let totalResourcesEvaluated = 0;
  let totalRecommendationCount = 0;
  const allErrors: ScanError[] = [];

  // Load advisor toggles from app settings
  let advisorToggles = { safeCleanup: true, permissionDrift: true, zombieResource: true, governancePolicy: true };
  try {
    const appSettings = await repo.getSetting("app_settings") as any;
    if (appSettings?.advisorToggles) {
      advisorToggles = { ...advisorToggles, ...appSettings.advisorToggles };
    }
  } catch { /* use defaults */ }

  // Run Safe Cleanup Advisor
  if (advisorToggles.safeCleanup) {
  try {
    const advisor = new SafeCleanupAdvisor(scanId);
    const result = await advisor.analyze({
      accountId,
      region,
      lookbackDays: lookbackPeriods.safeCleanupAdvisor,
      crossAccountRoleArn,
    });
    if (result.recommendations.length > 0) {
      await repo.putRecommendations(result.recommendations);
    }
    totalResourcesEvaluated += result.resourcesEvaluated;
    totalRecommendationCount += result.recommendations.length;
    allErrors.push(...result.errors);
  } catch (err: unknown) {
    const error = err as Error & { name?: string };
    allErrors.push({
      accountId,
      region,
      errorCode: error.name ?? "UnknownError",
      errorMessage: `SafeCleanupAdvisor failed: ${error.message}`,
    });
  }
  } // end safeCleanup toggle

  // Run Permission Drift Detector
  if (advisorToggles.permissionDrift) {
  try {
    const detector = new PermissionDriftDetector(scanId);
    const result = await detector.analyze({
      accountId,
      region,
      lookbackDays: lookbackPeriods.permissionDriftDetector,
      crossAccountRoleArn,
    });
    if (result.recommendations.length > 0) {
      await repo.putRecommendations(result.recommendations);
    }
    totalResourcesEvaluated += result.resourcesEvaluated;
    totalRecommendationCount += result.recommendations.length;
    allErrors.push(...result.errors);
  } catch (err: unknown) {
    const error = err as Error & { name?: string };
    allErrors.push({
      accountId,
      region,
      errorCode: error.name ?? "UnknownError",
      errorMessage: `PermissionDriftDetector failed: ${error.message}`,
    });
  }
  } // end permissionDrift toggle

  // Run Zombie Resource Detector
  if (advisorToggles.zombieResource) {
  try {
    const detector = new ZombieResourceDetector(scanId);
    const result = await detector.analyze({
      accountId,
      region,
      lookbackDays: lookbackPeriods.zombieResourceDetector,
      crossAccountRoleArn,
    });
    if (result.recommendations.length > 0) {
      await repo.putRecommendations(result.recommendations);
    }
    totalResourcesEvaluated += result.resourcesEvaluated;
    totalRecommendationCount += result.recommendations.length;
    allErrors.push(...result.errors);
  } catch (err: unknown) {
    const error = err as Error & { name?: string };
    allErrors.push({
      accountId,
      region,
      errorCode: error.name ?? "UnknownError",
      errorMessage: `ZombieResourceDetector failed: ${error.message}`,
    });
  }
  } // end zombieResource toggle

  // Run Dependency Graph Discovery
  try {
    const builder = new DependencyGraphBuilder();
    const graphResult = await builder.discover({
      scanId,
      accountId,
      region,
      crossAccountRoleArn,
    });

    if (graphResult.nodes.length > 0) {
      await repo.putGraphNodes(scanId, graphResult.nodes);
      await repo.putGraphEdges(scanId, graphResult.edges);
    }
    await repo.putGraphMeta(accountId, region, scanId);

    for (const graphError of graphResult.errors) {
      allErrors.push({
        accountId,
        region,
        resourceType: graphError.resourceType,
        errorCode: graphError.errorCode,
        errorMessage: `DependencyGraphBuilder: ${graphError.errorMessage}`,
      });
    }
  } catch (err: unknown) {
    const error = err as Error & { name?: string };
    allErrors.push({
      accountId,
      region,
      errorCode: error.name ?? "UnknownError",
      errorMessage: `DependencyGraphBuilder failed: ${error.message}`,
    });
  }

  // Run Governance Policy Engine
  if (advisorToggles.governancePolicy) {
  try {
    const policyEngine = new GovernancePolicyEngine(scanId);
    const policyResult = await policyEngine.evaluate({
      accountId,
      region,
      crossAccountRoleArn,
    });
    if (policyResult.recommendations.length > 0) {
      await repo.putRecommendations(policyResult.recommendations);
    }
    totalResourcesEvaluated += policyResult.resourcesEvaluated;
    totalRecommendationCount += policyResult.recommendations.length;
    allErrors.push(...policyResult.errors);
  } catch (err: unknown) {
    const error = err as Error & { name?: string };
    allErrors.push({
      accountId,
      region,
      errorCode: error.name ?? "UnknownError",
      errorMessage: `GovernancePolicyEngine failed: ${error.message}`,
    });
  }
  } // end governancePolicy toggle

  return {
    resourcesEvaluated: totalResourcesEvaluated,
    recommendationCount: totalRecommendationCount,
    errors: allErrors,
  };
}