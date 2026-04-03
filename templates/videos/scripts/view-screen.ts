/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state. If viewing a composition, returns its metadata.
 * If on studio home, returns the list of compositions.
 *
 * Usage:
 *   pnpm script view-screen
 */

import { parseArgs } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "See what the user is currently looking at on screen. Returns the current view and composition details. Always call this first before taking any action.",
  parameters: {
    type: "object",
    properties: {},
  },
};

export async function run(_args: Record<string, string>): Promise<string> {
  const navigation = await readAppState("navigation");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  const nav = navigation as any;

  if (nav?.compositionId) {
    screen.context = {
      view: "composition",
      compositionId: nav.compositionId,
      hint: "User is editing a composition. Use the registry in app/remotion/registry.ts for composition details.",
    };
  } else {
    screen.context = {
      view: "studio-home",
      hint: "User is on the studio home page. Compositions are registered in app/remotion/registry.ts.",
    };
  }

  if (Object.keys(screen).length === 0) {
    return "No application state found. Is the app running?";
  }
  return JSON.stringify(screen, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2)) as Record<string, string>;
  const result = await run(args);

  try {
    const parsed = JSON.parse(result);
    const nav = parsed.navigation;
    if (nav?.compositionId) {
      console.error(`Viewing composition: ${nav.compositionId}`);
    } else {
      console.error("Studio home view");
    }
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(result);
  }
}
