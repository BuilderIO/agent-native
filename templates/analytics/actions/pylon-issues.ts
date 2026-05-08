import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getAccounts, getIssues } from "../server/lib/pylon";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

export default defineAction({
  description:
    "Query Pylon support issues and customer accounts. Use this first when the user asks about Pylon, support tickets, support issues, or customer account data from Pylon. Do not use BigQuery for Pylon data unless the user explicitly asks for a warehouse copy.",
  schema: z.object({
    accounts: z.coerce
      .boolean()
      .optional()
      .describe("Set to true to list accounts"),
    account: z.string().optional().describe("Filter by account name"),
    state: z.string().optional().describe("Filter by issue state"),
    query: z.string().optional().describe("Search query"),
  }),
  http: false,
  run: async (args) => {
    const credentials = await requireActionCredentials(
      ["PYLON_API_KEY"],
      "Pylon",
    );
    if (credentials.ok === false) return credentials.response;

    try {
      if (args.accounts) {
        const accounts = await getAccounts(args.query);
        return { accounts, total: accounts.length };
      }

      let accountId: string | undefined;
      if (args.account) {
        const accounts = await getAccounts(args.account);
        const match = accounts.find((a) =>
          a.name.toLowerCase().includes(args.account!.toLowerCase()),
        );
        if (match) accountId = match.id;
      }

      const issues = await getIssues({
        account_id: accountId,
        state: args.state,
        query: args.query,
      });

      return { issues, total: issues.length };
    } catch (err) {
      return providerError(err);
    }
  },
});
