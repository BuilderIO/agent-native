#!/usr/bin/env tsx
/**
 * Query Gong sales calls, transcripts, and users.
 *
 * Usage:
 *   pnpm script gong-calls
 *   pnpm script gong-calls --company=Acme
 *   pnpm script gong-calls --days=30
 *   pnpm script gong-calls --transcript=123456
 *   pnpm script gong-calls --users  (list Gong users)
 */
import { parseArgs, output } from "./helpers";
import {
  getCalls,
  getCallTranscript,
  getUsers,
  searchCalls,
} from "../server/lib/gong";

const args = parseArgs();

if (args.users) {
  const users = await getUsers();
  output({ users, total: users.length });
} else if (args.transcript) {
  const transcript = await getCallTranscript(args.transcript);
  output({ transcript });
} else if (args.company) {
  const days = args.days ? parseInt(args.days) : 90;
  const calls = await searchCalls(args.company, days);
  output({ calls, total: calls.length, query: args.company, days });
} else {
  const days = args.days ? parseInt(args.days) : 30;
  const fromDateTime = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = await getCalls({ fromDateTime });
  output({ calls: result.calls, total: result.calls.length, days });
}
