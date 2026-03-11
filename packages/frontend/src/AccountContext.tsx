import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getSummary, getSetting } from "./api-client";

export interface AccountOption {
  accountId: string;
  label: string;
  isPrimary: boolean;
}

interface AccountContextType {
  accounts: AccountOption[];
  selectedAccountId: string | null; // null = "All Accounts"
  setSelectedAccountId: (id: string | null) => void;
  loading: boolean;
  refresh: () => void;
}

const AccountContext = createContext<AccountContextType>({
  accounts: [],
  selectedAccountId: null,
  setSelectedAccountId: () => {},
  loading: true,
  refresh: () => {},
});

export function useAccount() {
  return useContext(AccountContext);
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(() => {
    return localStorage.getItem("cg_selected_account") || null;
  });
  const [loading, setLoading] = useState(true);

  const setSelectedAccountId = (id: string | null) => {
    setSelectedAccountIdState(id);
    if (id) localStorage.setItem("cg_selected_account", id);
    else localStorage.removeItem("cg_selected_account");
  };

  const fetchAccounts = useCallback(async () => {
    try {
      const [summary, extraRes] = await Promise.all([
        getSummary(),
        getSetting<{ accountId: string; alias: string; roleArn: string }[]>("extra_accounts"),
      ]);

      const accts: AccountOption[] = [];

      // Primary account from summary
      if (summary.accountInfo) {
        accts.push({
          accountId: summary.accountInfo.accountId,
          label: summary.accountInfo.accountName !== summary.accountInfo.accountId
            ? summary.accountInfo.accountName
            : `Account ${summary.accountInfo.accountId}`,
          isPrimary: true,
        });
      }

      // Extra accounts from settings
      const extras = extraRes.value;
      if (extras && Array.isArray(extras)) {
        for (const ea of extras) {
          if (ea.accountId && !accts.find(a => a.accountId === ea.accountId)) {
            accts.push({
              accountId: ea.accountId,
              label: ea.alias || `Account ${ea.accountId}`,
              isPrimary: false,
            });
          }
        }
      }

      // Also add any accounts from perAccount that aren't already listed
      if (summary.perAccount) {
        for (const acctId of Object.keys(summary.perAccount)) {
          if (acctId !== "self" && !accts.find(a => a.accountId === acctId)) {
            accts.push({ accountId: acctId, label: `Account ${acctId}`, isPrimary: false });
          }
        }
      }

      setAccounts(accts);
    } catch {
      // ignore — accounts will be empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  return (
    <AccountContext.Provider value={{ accounts, selectedAccountId, setSelectedAccountId, loading, refresh: fetchAccounts }}>
      {children}
    </AccountContext.Provider>
  );
}
