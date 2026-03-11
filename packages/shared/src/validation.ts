import { GovernanceConfig } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_REPORT_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
const VALID_SCAN_MODES = ["single-account", "organization"] as const;

/**
 * Validates a lookback period value. Must be an integer between 7 and 365 inclusive.
 */
export function validateLookbackPeriod(value: number): ValidationResult {
  const errors: string[] = [];

  if (!Number.isInteger(value)) {
    errors.push("Lookback period must be an integer");
  } else if (value < 7 || value > 365) {
    errors.push("Lookback period must be between 7 and 365 days");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates a report frequency value. Must be "daily", "weekly", or "monthly".
 */
export function validateReportFrequency(value: string): ValidationResult {
  const errors: string[] = [];

  if (!(VALID_REPORT_FREQUENCIES as readonly string[]).includes(value)) {
    errors.push(
      `Invalid report frequency "${value}". Must be one of: ${VALID_REPORT_FREQUENCIES.join(", ")}`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates a complete GovernanceConfig object.
 */
export function validateGovernanceConfig(config: GovernanceConfig): ValidationResult {
  const errors: string[] = [];

  // Validate scanMode
  if (!(VALID_SCAN_MODES as readonly string[]).includes(config.scanMode)) {
    errors.push(
      `Invalid scan mode "${config.scanMode}". Must be one of: ${VALID_SCAN_MODES.join(", ")}`
    );
  }

  // Validate scanSchedule
  if (!config.scanSchedule || config.scanSchedule.trim().length === 0) {
    errors.push("Scan schedule must be a non-empty string");
  }

  // Validate lookback periods
  const lookbackFields = [
    { field: "safeCleanupAdvisor", value: config.lookbackPeriods.safeCleanupAdvisor },
    { field: "permissionDriftDetector", value: config.lookbackPeriods.permissionDriftDetector },
    { field: "zombieResourceDetector", value: config.lookbackPeriods.zombieResourceDetector },
  ];

  for (const { field, value } of lookbackFields) {
    const result = validateLookbackPeriod(value);
    for (const error of result.errors) {
      errors.push(`lookbackPeriods.${field}: ${error}`);
    }
  }

  // Validate regions is an array
  if (!Array.isArray(config.regions)) {
    errors.push("Regions must be an array");
  }

  // Validate reportConfig.frequency
  const freqResult = validateReportFrequency(config.reportConfig.frequency);
  for (const error of freqResult.errors) {
    errors.push(`reportConfig.frequency: ${error}`);
  }

  // Validate reportConfig.recipients when enabled
  if (config.reportConfig.enabled) {
    if (!Array.isArray(config.reportConfig.recipients) || config.reportConfig.recipients.length === 0) {
      errors.push("reportConfig.recipients must be a non-empty array when reporting is enabled");
    }
  }

  // Validate crossAccountRoleName
  if (!config.crossAccountRoleName || config.crossAccountRoleName.trim().length === 0) {
    errors.push("crossAccountRoleName must be a non-empty string");
  }

  // Validate organizationConfig is required when scanMode is "organization"
  if (config.scanMode === "organization" && !config.organizationConfig) {
    errors.push("organizationConfig is required when scanMode is \"organization\"");
  }

  return { valid: errors.length === 0, errors };
}
