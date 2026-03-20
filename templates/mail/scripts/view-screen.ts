/**
 * See what the user is currently looking at on screen.
 *
 * Reads application-state files to show the current view, email list,
 * and open thread (if any).
 *
 * Usage:
 *   pnpm script view-screen
 */

import fs from "fs";
import path from "path";
import { parseArgs, output } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

const STATE_DIR = path.join(process.cwd(), "application-state");

function readJson(filename: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(STATE_DIR, filename), "utf-8"));
  } catch {
    return null;
  }
}

export const tool: ScriptTool = {
  description: "See what the user is currently looking at on screen. Returns the current view, email list, and open thread (if any). Always call this first before taking any action.",
  parameters: {
    type: "object",
    properties: {
      full: { type: "string", description: "Set to 'true' for full detail (deprecated, now always returns full detail)", enum: ["true", "false"] },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const navigation = readJson("navigation.json");
  const emailList = readJson("email-list.json");
  const thread = readJson("thread.json");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;
  if (emailList) screen.emailList = emailList;
  if (thread) screen.thread = thread;

  if (Object.keys(screen).length === 0) {
    return "No application state found. Is the app running?";
  }
  return JSON.stringify(screen, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  const navigation = readJson("navigation.json");
  const emailList = readJson("email-list.json");
  const thread = readJson("thread.json");

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
      ((navigation as any)?.threadId
        ? ` (thread: ${(navigation as any).threadId})`
        : "") +
      ` — ${(emailList as any)?.count ?? 0} email(s) on screen`,
  );
  output(screen);
}
