/**
 * Exports emails for a given view to stdout (or a file).
 * Usage: pnpm script export-emails --view=inbox --output=/tmp/inbox.json
 *        pnpm script export-emails --view=sent --grep=design
 */

import fs from "fs";
import path from "path";
import { parseArgs, output, fatal } from "./helpers.js";

const EMAILS_FILE = path.join(process.cwd(), "data", "emails.json");

export default async function main(): Promise<void> {
  const args = parseArgs();
  const view = args.view ?? "inbox";
  const outputPath = args.output;

  const emails: any[] = JSON.parse(fs.readFileSync(EMAILS_FILE, "utf-8"));

  let filtered = emails;
  switch (view) {
    case "inbox":
      filtered = emails.filter((e) => !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent);
      break;
    case "starred":
      filtered = emails.filter((e) => e.isStarred && !e.isTrashed);
      break;
    case "sent":
      filtered = emails.filter((e) => e.isSent);
      break;
    case "drafts":
      filtered = emails.filter((e) => e.isDraft);
      break;
    case "archive":
      filtered = emails.filter((e) => e.isArchived && !e.isTrashed);
      break;
    case "trash":
      filtered = emails.filter((e) => e.isTrashed);
      break;
    case "all":
      break;
    default:
      fatal(`Unknown view "${view}". Valid: inbox, starred, sent, drafts, archive, trash, all`);
  }

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(filtered, null, 2));
    console.error(`✓ Exported ${filtered.length} email(s) from "${view}" to ${outputPath}`);
  } else {
    output(filtered);
  }
}
