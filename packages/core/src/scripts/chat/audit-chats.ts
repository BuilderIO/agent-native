import { auditChats, type ChatAuditThread } from "../../chat-threads/audit.js";
import { parseArgs, fail } from "../utils.js";

function formatTime(ts: number): string {
  return new Date(ts).toISOString();
}

function printText(threads: ChatAuditThread[]): void {
  for (const t of threads) {
    console.log(`${t.title || "(untitled)"}`);
    console.log(
      `  thread ${t.threadId}  owner ${t.ownerEmail}  ${t.messageCount} msgs  updated ${formatTime(t.updatedAt)}${t.archivedAt ? "  archived" : ""}`,
    );
    if (t.scopeId) console.log(`  scope ${t.scopeType ?? "?"} ${t.scopeId}`);
    if (t.sourceUrl) console.log(`  source ${t.sourceUrl}`);
    for (const r of t.runs) {
      const err = r.errorCode ? `  error ${r.errorCode}` : "";
      const who = r.initiatorEmail ? `  by ${r.initiatorEmail}` : "";
      console.log(
        `    run ${r.runId}  ${r.status}  ${formatTime(r.startedAt)}${r.terminalReason ? `  ${r.terminalReason}` : ""}${err}${who}`,
      );
    }
    console.log();
  }
}

export default async function auditChatsCli(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action audit-chats [options]

Find chats across all owners, with their runs. Read-only, operator use only.

Options:
  --email <address>    Chats the email owns or sent a turn in
  --deck <url|id>      Chats attached to, linked to, or mentioning a deck
  --thread <id>        One chat
  --run <id>           The chat that contains a run
  --limit N            Max chats (default: 20)
  --format json        Output as JSON
  --help               Show this help message

At least one of --email, --deck, --thread, or --run is required.`);
    return;
  }

  const limit = parsed.limit ? parseInt(parsed.limit, 10) : 20;
  if (isNaN(limit) || limit < 1) fail("--limit must be a positive integer");

  if (!parsed.email && !parsed.deck && !parsed.thread && !parsed.run) {
    fail("audit-chats needs --email, --deck, --thread, or --run");
  }

  const threads = await auditChats({
    email: parsed.email,
    deck: parsed.deck,
    threadId: parsed.thread,
    runId: parsed.run,
    limit,
  });

  if (parsed.format === "json") {
    console.log(JSON.stringify({ threads, count: threads.length }, null, 2));
    return;
  }

  if (threads.length === 0) {
    console.log("No matching chats");
    return;
  }
  printText(threads);
}
