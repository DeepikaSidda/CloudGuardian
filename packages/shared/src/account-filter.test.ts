import { applyAccountFilter } from "./account-filter";
import { AccountFilter } from "./types";

describe("applyAccountFilter", () => {
  const allAccounts = ["111111111111", "222222222222", "333333333333", "444444444444"];
  const accountToOUMap: Record<string, string> = {
    "111111111111": "ou-prod",
    "222222222222": "ou-prod",
    "333333333333": "ou-dev",
    "444444444444": "ou-staging",
  };

  it("returns all accounts when filter is empty", () => {
    const result = applyAccountFilter(allAccounts, {});
    expect(result.accounts).toEqual(allAccounts);
    expect(result.warnings).toEqual([]);
  });

  it("returns all accounts when include and exclude arrays are empty", () => {
    const filter: AccountFilter = {
      includeAccounts: [],
      includeOUs: [],
      excludeAccounts: [],
      excludeOUs: [],
    };
    const result = applyAccountFilter(allAccounts, filter);
    expect(result.accounts).toEqual(allAccounts);
    expect(result.warnings).toEqual([]);
  });

  it("includes only specified accounts", () => {
    const filter: AccountFilter = { includeAccounts: ["111111111111", "333333333333"] };
    const result = applyAccountFilter(allAccounts, filter);
    expect(result.accounts).toEqual(["111111111111", "333333333333"]);
    expect(result.warnings).toEqual([]);
  });

  it("includes accounts by OU", () => {
    const filter: AccountFilter = { includeOUs: ["ou-prod"] };
    const result = applyAccountFilter(allAccounts, filter, accountToOUMap);
    expect(result.accounts).toEqual(["111111111111", "222222222222"]);
  });

  it("combines includeAccounts and includeOUs (union)", () => {
    const filter: AccountFilter = {
      includeAccounts: ["444444444444"],
      includeOUs: ["ou-dev"],
    };
    const result = applyAccountFilter(allAccounts, filter, accountToOUMap);
    expect(result.accounts).toEqual(["333333333333", "444444444444"]);
  });

  it("excludes specified accounts from all", () => {
    const filter: AccountFilter = { excludeAccounts: ["222222222222"] };
    const result = applyAccountFilter(allAccounts, filter);
    expect(result.accounts).toEqual(["111111111111", "333333333333", "444444444444"]);
  });

  it("excludes accounts by OU", () => {
    const filter: AccountFilter = { excludeOUs: ["ou-prod"] };
    const result = applyAccountFilter(allAccounts, filter, accountToOUMap);
    expect(result.accounts).toEqual(["333333333333", "444444444444"]);
  });

  it("applies include first, then exclude", () => {
    const filter: AccountFilter = {
      includeOUs: ["ou-prod"],
      excludeAccounts: ["111111111111"],
    };
    const result = applyAccountFilter(allAccounts, filter, accountToOUMap);
    expect(result.accounts).toEqual(["222222222222"]);
  });

  it("returns empty with warning when all accounts are excluded", () => {
    const filter: AccountFilter = {
      excludeAccounts: allAccounts,
    };
    const result = applyAccountFilter(allAccounts, filter);
    expect(result.accounts).toEqual([]);
    expect(result.warnings).toContain("All accounts were excluded by filter rules");
  });

  it("returns empty array with no warning when input accounts is empty", () => {
    const result = applyAccountFilter([], { excludeAccounts: ["111111111111"] });
    expect(result.accounts).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("ignores OU-based filtering when no accountToOUMap is provided", () => {
    const filter: AccountFilter = { includeOUs: ["ou-prod"] };
    const result = applyAccountFilter(allAccounts, filter);
    // No accounts match OU rules without a map, so result is empty
    expect(result.accounts).toEqual([]);
    expect(result.warnings).toContain("All accounts were excluded by filter rules");
  });

  it("exclude OU overrides include account", () => {
    const filter: AccountFilter = {
      includeAccounts: ["111111111111", "333333333333"],
      excludeOUs: ["ou-prod"],
    };
    const result = applyAccountFilter(allAccounts, filter, accountToOUMap);
    // 111111111111 is in ou-prod so excluded, 333333333333 is in ou-dev so kept
    expect(result.accounts).toEqual(["333333333333"]);
  });
});
