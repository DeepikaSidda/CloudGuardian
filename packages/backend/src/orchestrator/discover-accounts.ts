import {
  OrganizationsClient,
  ListAccountsCommand,
  type Account,
} from "@aws-sdk/client-organizations";
import {
  applyAccountFilter,
  type AccountFilter,
  type ScanMode,
} from "@governance-engine/shared";
import { GovernanceDataRepository } from "../repository";

const repo = new GovernanceDataRepository();

export interface DiscoverAccountsInput {
  scanMode: ScanMode;
  accountFilter?: { accountFilter: AccountFilter };
}

export interface ExtraAccount {
  accountId: string;
  alias: string;
  roleArn: string;
}

export interface DiscoverAccountsOutput {
  accountIds: string[];
}

export async function handler(
  event: DiscoverAccountsInput
): Promise<DiscoverAccountsOutput> {
  // Always read manually-added extra accounts from settings
  let extraAccounts: ExtraAccount[] = [];
  try {
    const setting = await repo.getSetting("extra_accounts");
    if (setting && Array.isArray(setting)) {
      extraAccounts = setting as ExtraAccount[];
    }
  } catch { /* ignore — extra accounts are optional */ }

  if (event.scanMode !== "organization") {
    // Single-account mode + any manually-added extra accounts
    const accountIds = ["self"];
    for (const acct of extraAccounts) {
      if (acct.accountId && !accountIds.includes(acct.accountId)) {
        accountIds.push(acct.accountId);
      }
    }
    return {
      accountIds,
    };
  }

  const orgClient = new OrganizationsClient({});
  const accounts: Account[] = [];
  let nextToken: string | undefined;

  do {
    const response = await orgClient.send(
      new ListAccountsCommand({ NextToken: nextToken })
    );
    accounts.push(...(response.Accounts ?? []));
    nextToken = response.NextToken;
  } while (nextToken);

  const accountIds = accounts
    .filter((a) => a.Status === "ACTIVE" && a.Id)
    .map((a) => a.Id!);

  // Also include manually-added extra accounts not already in the org list
  for (const acct of extraAccounts) {
    if (acct.accountId && !accountIds.includes(acct.accountId)) {
      accountIds.push(acct.accountId);
    }
  }

  // Apply account filters if provided
  const filter = event.accountFilter?.accountFilter ?? {};
  const { accounts: filtered } = applyAccountFilter(accountIds, filter);

  return {
    accountIds: filtered,
  };
}
