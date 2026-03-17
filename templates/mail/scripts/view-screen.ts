/**
 * See what the user is currently looking at on screen.
 *
 * Reads application-state files to show the current view, email list,
 * and open thread (if any).
 *
 * Usage:
 *   pnpm script view-screen
 *   pnpm script view-screen --full    (include thread messages)
 */

import fs from "fs";
import path from "path";
import { parseArgs, output } from "./helpers.js";

const STATE_DIR = path.join(process.cwd(), "application-state");

function readJson(filename: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(STATE_DIR, filename), "utf-8"));
  } catch {
    return null;
  }
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const full = args.full === "true";

  const navigation = readJson("navigation.json");
  const emailList = readJson("email-list.json");
  const thread = full ? readJson("thread.json") : null;

  const screen: Record<string, unknown> = {};

  if (navigation) screen.navigation = navigation;
  if (emailList) screen.emailList = emailList;
  if (thread) screen.thread = thread;

  if (Object.keys(screen).length === 0) {
    console.error("No application state found. Is the app running?");
    return;
  }

  console.error(
    `Current view: ${(navigation as any)?.view ?? "unknown"}` +
    ((navigation as any)?.threadId ? ` (thread: ${(navigation as any).threadId})` : "") +
    ` — ${(emailList as any)?.count ?? 0} email(s) on screen`
  );
  output(screen);
}
