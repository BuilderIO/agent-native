#!/usr/bin/env tsx
/**
 * Query Pylon support issues and accounts.
 *
 * Usage:
 *   pnpm script pylon-issues
 *   pnpm script pylon-issues --account="Example Corp"
 *   pnpm script pylon-issues --state=open
 *   pnpm script pylon-issues --query=billing
 *   pnpm script pylon-issues --accounts   (list accounts only)
 */
import { parseArgs, output } from "./helpers";
import { getAccounts, getIssues } from "../server/lib/pylon";

const args = parseArgs();

if (args.accounts) {
  const accounts = await getAccounts(args.query);
  output({ accounts, total: accounts.length });
} else {
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

  output({ issues, total: issues.length });
}
