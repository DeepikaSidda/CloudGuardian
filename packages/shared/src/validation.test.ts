import {
  validateLookbackPeriod,
  validateReportFrequency,
  validateGovernanceConfig,
} from "./validation";
import { GovernanceConfig } from "./types";

function makeValidConfig(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    scanMode: "single-account",
    scanSchedule: "cron(0 6 * * ? *)",
    lookbackPeriods: {
      safeCleanupAdvisor: 90,
      permissionDriftDetector: 90,
      zombieResourceDetector: 90,
    },
    regions: ["us-east-1"],
    reportConfig: {
      enabled: true,
      frequency: "weekly",
      recipients: ["admin@example.com"],
    },
    crossAccountRoleName: "GovernanceEngineReadOnlyRole",
    ...overrides,
  };
}

describe("validateLookbackPeriod", () => {
  it("accepts 7 (minimum)", () => {
    expect(validateLookbackPeriod(7)).toEqual({ valid: true, errors: [] });
  });

  it("accepts 365 (maximum)", () => {
    expect(validateLookbackPeriod(365)).toEqual({ valid: true, errors: [] });
  });

  it("accepts 90 (typical value)", () => {
    expect(validateLookbackPeriod(90)).toEqual({ valid: true, errors: [] });
  });

  it("rejects 6 (below minimum)", () => {
    const result = validateLookbackPeriod(6);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("rejects 366 (above maximum)", () => {
    const result = validateLookbackPeriod(366);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("rejects non-integer values", () => {
    const result = validateLookbackPeriod(90.5);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("integer");
  });

  it("rejects negative values", () => {
    const result = validateLookbackPeriod(-1);
    expect(result.valid).toBe(false);
  });

  it("rejects zero", () => {
    const result = validateLookbackPeriod(0);
    expect(result.valid).toBe(false);
  });
});

describe("validateReportFrequency", () => {
  it.each(["daily", "weekly", "monthly"])("accepts '%s'", (freq) => {
    expect(validateReportFrequency(freq)).toEqual({ valid: true, errors: [] });
  });

  it("rejects 'yearly'", () => {
    const result = validateReportFrequency("yearly");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("yearly");
  });

  it("rejects empty string", () => {
    const result = validateReportFrequency("");
    expect(result.valid).toBe(false);
  });

  it("rejects 'Daily' (case-sensitive)", () => {
    const result = validateReportFrequency("Daily");
    expect(result.valid).toBe(false);
  });
});

describe("validateGovernanceConfig", () => {
  it("accepts a valid single-account config", () => {
    const result = validateGovernanceConfig(makeValidConfig());
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("accepts a valid organization config", () => {
    const result = validateGovernanceConfig(
      makeValidConfig({
        scanMode: "organization",
        organizationConfig: {
          managementAccountId: "123456789012",
          accountFilter: {},
        },
      })
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects invalid scanMode", () => {
    const result = validateGovernanceConfig(
      makeValidConfig({ scanMode: "invalid" as any })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("scan mode"))).toBe(true);
  });

  it("rejects empty scanSchedule", () => {
    const result = validateGovernanceConfig(makeValidConfig({ scanSchedule: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Scan schedule"))).toBe(true);
  });

  it("rejects whitespace-only scanSchedule", () => {
    const result = validateGovernanceConfig(makeValidConfig({ scanSchedule: "   " }));
    expect(result.valid).toBe(false);
  });

  it("rejects invalid lookback periods", () => {
    const result = validateGovernanceConfig(
      makeValidConfig({
        lookbackPeriods: {
          safeCleanupAdvisor: 3,
          permissionDriftDetector: 400,
          zombieResourceDetector: 90,
        },
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it("rejects invalid report frequency", () => {
    const result = validateGovernanceConfig(
      makeValidConfig({
        reportConfig: { enabled: false, frequency: "yearly" as any, recipients: [] },
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("frequency"))).toBe(true);
  });

  it("rejects empty recipients when reporting is enabled", () => {
    const result = validateGovernanceConfig(
      makeValidConfig({
        reportConfig: { enabled: true, frequency: "daily", recipients: [] },
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("recipients"))).toBe(true);
  });

  it("allows empty recipients when reporting is disabled", () => {
    const result = validateGovernanceConfig(
      makeValidConfig({
        reportConfig: { enabled: false, frequency: "daily", recipients: [] },
      })
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects empty crossAccountRoleName", () => {
    const result = validateGovernanceConfig(
      makeValidConfig({ crossAccountRoleName: "" })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("crossAccountRoleName"))).toBe(true);
  });

  it("rejects organization mode without organizationConfig", () => {
    const result = validateGovernanceConfig(
      makeValidConfig({ scanMode: "organization" })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("organizationConfig"))).toBe(true);
  });

  it("collects multiple errors at once", () => {
    const result = validateGovernanceConfig(
      makeValidConfig({
        scanSchedule: "",
        crossAccountRoleName: "",
        lookbackPeriods: {
          safeCleanupAdvisor: 1,
          permissionDriftDetector: 1,
          zombieResourceDetector: 1,
        },
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(5);
  });

  it("accepts config with empty regions array", () => {
    const result = validateGovernanceConfig(makeValidConfig({ regions: [] }));
    expect(result).toEqual({ valid: true, errors: [] });
  });
});
