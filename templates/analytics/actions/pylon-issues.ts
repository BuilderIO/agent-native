import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getAccounts, getIssues, type PylonIssue } from "../server/lib/pylon";
import { cliBoolean } from "./schema-helpers";

type StateBucket = "open" | "waiting" | "resolved" | "other";

function bucketState(state: string | undefined): StateBucket {
  const s = (state ?? "").toLowerCase();
  if (/(resolv|closed|done|complete|cancel)/.test(s)) return "resolved";
  if (/(wait|hold|pending|snooz|customer)/.test(s)) return "waiting";
  if (/(open|new|active|progress|on_you)/.test(s)) return "open";
  return "other";
}

interface AccountSummary {
  accountId: string | null;
  accountName: string;
  open: number;
  waiting: number;
  resolved: number;
  other: number;
  total: number;
  oldestTicketDate: string | null;
}

function summarizeByAccount(
  issues: PylonIssue[],
  accountNameById: Map<string, string>,
): AccountSummary[] {
  const byAccount = new Map<string, AccountSummary>();
  for (const issue of issues) {
    const accountId = issue.account_id ?? null;
    const key = accountId ?? "__unassigned__";
    let row = byAccount.get(key);
    if (!row) {
      row = {
        accountId,
        accountName: accountId
          ? (accountNameById.get(accountId) ?? accountId)
          : "Unassigned",
        open: 0,
        waiting: 0,
        resolved: 0,
        other: 0,
        total: 0,
        oldestTicketDate: null,
      };
      byAccount.set(key, row);
    }
    row[bucketState(issue.state)] += 1;
    row.total += 1;
    const created = issue.created_at;
    if (created && (!row.oldestTicketDate || created < row.oldestTicketDate)) {
      row.oldestTicketDate = created;
    }
  }
  return [...byAccount.values()].sort((a, b) => b.total - a.total);
}

export default defineAction({
  // Read-only provider query: safe to call from the extension `appAction`
  // bridge and reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description:
    "Query Pylon support tickets and accounts for the last 30 days. Pass accounts=true to list accounts. Pass account to filter issues by account name. Pass summary=true (default) to also return a per-account rollup of open/waiting/resolved counts with the oldest ticket date — ideal for risk/health dashboards. The Pylon API enforces a 30-day window.",
  schema: z.object({
    accounts: cliBoolean
      .optional()
      .describe("List Pylon accounts instead of issues."),
    account: z
      .string()
      .optional()
      .describe(
        "Filter issues to a single account by name (case-insensitive).",
      ),
    state: z
      .string()
      .optional()
      .describe("Filter issues by raw Pylon state, e.g. open or closed."),
    query: z.string().optional().describe("Full-text search across issues."),
    summary: cliBoolean
      .optional()
      .describe(
        "Include a per-account rollup of open/waiting/resolved counts and oldest ticket date (default true).",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const accountsList = await getAccounts();

    if (args.accounts) {
      return { accounts: accountsList, total: accountsList.length };
    }

    const accountNameById = new Map<string, string>();
    for (const account of accountsList) {
      accountNameById.set(account.id, account.name);
    }

    let accountId: string | undefined;
    if (args.account) {
      const wanted = args.account.toLowerCase();
      const match = accountsList.find((a) => a.name?.toLowerCase() === wanted);
      accountId = match?.id;
      if (!accountId) {
        return {
          issues: [],
          total: 0,
          summary: [],
          guidance: `No Pylon account matched "${args.account}". Pass accounts=true to list available account names.`,
        };
      }
    }

    const issues = await getIssues({
      ...(accountId ? { account_id: accountId } : {}),
      ...(args.state ? { state: args.state } : {}),
      ...(args.query ? { query: args.query } : {}),
    });

    const includeSummary = args.summary !== false;
    return {
      issues,
      total: issues.length,
      window: "last 30 days",
      ...(includeSummary
        ? { summary: summarizeByAccount(issues, accountNameById) }
        : {}),
    };
  },
});
