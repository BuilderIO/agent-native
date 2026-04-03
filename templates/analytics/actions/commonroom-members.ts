#!/usr/bin/env tsx
/**
 * Query Common Room community members.
 *
 * Usage:
 *   pnpm action commonroom-members --email=user@example.com
 *   pnpm action commonroom-members --query=Builder
 *   pnpm action commonroom-members --segments  (list segments)
 */
import { parseArgs, output } from "./helpers";
import {
  getMemberByEmail,
  getMembers,
  getSegments,
} from "../server/lib/commonroom";

const args = parseArgs();

if (args.segments) {
  const segments = await getSegments();
  output({ segments });
} else if (args.email) {
  const member = await getMemberByEmail(args.email);
  if (member) {
    output({ member });
  } else {
    output({ error: `No member found for email: ${args.email}` });
  }
} else {
  const result = await getMembers({
    query: args.query,
    limit: args.limit ? parseInt(args.limit) : 25,
  });
  output({ members: result.items, total: result.items?.length ?? 0 });
}
