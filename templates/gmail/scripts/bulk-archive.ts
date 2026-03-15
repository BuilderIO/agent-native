/**
 * Archives emails older than N days from inbox.
 * Usage: pnpm script bulk-archive --older-than=30
 */

import fs from "fs";
import path from "path";
import { parseArgs, output, fatal } from "./helpers.js";

const EMAILS_FILE = path.join(process.cwd(), "data", "emails.json");

export default async function main(): Promise<void> {
  const args = parseArgs();
  const days = args["older-than"] ? parseInt(args["older-than"], 10) : 30;

  if (isNaN(days) || days < 1)
    fatal("--older-than must be a positive integer (days)");

  const emails: any[] = JSON.parse(fs.readFileSync(EMAILS_FILE, "utf-8"));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  let archived = 0;
  const updated = emails.map((email) => {
    if (
      !email.isArchived &&
      !email.isTrashed &&
      !email.isDraft &&
      new Date(email.date).getTime() < cutoff
    ) {
      archived++;
      return {
        ...email,
        isArchived: true,
        labelIds: email.labelIds.filter((l: string) => l !== "inbox"),
      };
    }
    return email;
  });

  fs.writeFileSync(EMAILS_FILE, JSON.stringify(updated, null, 2));

  output({
    archived,
    days,
    total: emails.length,
    message: `Archived ${archived} email(s) older than ${days} days`,
  });
}
