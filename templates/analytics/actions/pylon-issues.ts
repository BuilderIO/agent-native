import { defineAction } from "@agent-native/core";
import { getAccounts, getIssues } from "../server/lib/pylon";

export default defineAction({
  description:
    "Query Pylon support issues and accounts. Pass --accounts for account list, --account to filter by account.",
  parameters: {
    accounts: { type: "string", description: "Set to 'true' to list accounts" },
    account: { type: "string", description: "Filter by account name" },
    state: { type: "string", description: "Filter by issue state" },
    query: { type: "string", description: "Search query" },
  },
  http: false,
  run: async (args) => {
    if (args.accounts === "true") {
      const accounts = await getAccounts(args.query);
      return { accounts, total: accounts.length };
    }

    let accountId: string | undefined;
    if (args.account) {
      const accounts = await getAccounts(args.account);
      const match = accounts.find((a) =>
        a.name.toLowerCase().includes(args.account.toLowerCase()),
      );
      if (match) accountId = match.id;
    }

    const issues = await getIssues({
      account_id: accountId,
      state: args.state,
      query: args.query,
    });

    return { issues, total: issues.length };
  },
});
