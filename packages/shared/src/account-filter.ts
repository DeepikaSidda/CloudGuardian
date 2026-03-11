import { AccountFilter } from "./types";

export interface AccountFilterResult {
  accounts: string[];
  warnings: string[];
}

/**
 * Applies include/exclude filter rules to a list of account IDs.
 *
 * Logic:
 * 1. If no include rules exist, start with all accounts.
 * 2. If include rules exist, start with only matching accounts.
 * 3. Then remove accounts matching exclude rules.
 * 4. OU-based filtering uses the optional accountToOUMap.
 */
export function applyAccountFilter(
  accounts: string[],
  filter: AccountFilter,
  accountToOUMap: Record<string, string> = {}
): AccountFilterResult {
  const warnings: string[] = [];

  const hasIncludeAccounts = filter.includeAccounts && filter.includeAccounts.length > 0;
  const hasIncludeOUs = filter.includeOUs && filter.includeOUs.length > 0;
  const hasIncludeRules = hasIncludeAccounts || hasIncludeOUs;

  // Step 1 & 2: Apply include rules
  let result: string[];
  if (!hasIncludeRules) {
    result = [...accounts];
  } else {
    const includeAccountSet = new Set(filter.includeAccounts ?? []);
    const includeOUSet = new Set(filter.includeOUs ?? []);

    result = accounts.filter(
      (acct) =>
        includeAccountSet.has(acct) ||
        (accountToOUMap[acct] !== undefined && includeOUSet.has(accountToOUMap[acct]))
    );
  }

  // Step 3: Apply exclude rules
  const excludeAccountSet = new Set(filter.excludeAccounts ?? []);
  const excludeOUSet = new Set(filter.excludeOUs ?? []);

  result = result.filter(
    (acct) =>
      !excludeAccountSet.has(acct) &&
      !(accountToOUMap[acct] !== undefined && excludeOUSet.has(accountToOUMap[acct]))
  );

  // Step 4: Warn if all accounts were excluded
  if (result.length === 0 && accounts.length > 0) {
    warnings.push("All accounts were excluded by filter rules");
  }

  return { accounts: result, warnings };
}
