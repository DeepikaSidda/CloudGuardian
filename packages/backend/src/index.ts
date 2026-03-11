// @governance-engine/backend
// Lambda handler functions for the AWS Account Governance Engine

export { SafeCleanupAdvisor } from "./advisors/safe-cleanup-advisor";
export { PermissionDriftDetector } from "./advisors/permission-drift-detector";
export { ZombieResourceDetector } from "./advisors/zombie-resource-detector";
export { ActionExecutor } from "./action-executor";
export { GovernanceDataRepository } from "./repository";
export { ReportScheduler } from "./report-scheduler";
export { getClientForAccount, assumeCrossAccountRole } from "./credentials";
