import { isAgentCaller } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  navigateAfterWrite,
  writeAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { z } from "zod";

import {
  resourcePath,
  type NavigableKind,
} from "../app/lib/navigation-contract.js";

export const agentOpenIntentSchema = z
  .literal("open")
  .optional()
  .describe('Pass "open" only when the user asked to open or show the result.');

export const agentNavigationKeptSchema = z.object({
  kept: z.literal(true),
  navigated: z.literal(false),
  reason: z.enum([
    "detail-requires-open-intent",
    "write-keeps-view",
    "navigation-mode-keep",
  ]),
  currentView: z.record(z.string(), z.unknown()).nullable(),
  message: z.string(),
});

export const agentNavigationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("requested") }),
  z.object({ status: z.literal("kept") }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.enum(["browser_tab_missing", "command_write_failed"]),
  }),
]);

export function queueAnalyticsNavigation(path: string) {
  return writeAppStateForCurrentTab("navigate", {
    path,
    _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
}

export async function showAgentResource(
  context: ActionRunContext | undefined,
  kind: NavigableKind,
  id: string,
  intent?: "open",
): Promise<{ navigation?: z.infer<typeof agentNavigationSchema> }> {
  if (!isAgentCaller(context?.caller)) return {};
  try {
    const result = await navigateAfterWrite(
      { path: resourcePath(kind, id) },
      { ctx: context, intent },
    );
    if (result.navigated) return { navigation: { status: "requested" } };
    return result.reason === "no-tab"
      ? {
          navigation: { status: "unavailable", reason: "browser_tab_missing" },
        }
      : { navigation: { status: "kept" } };
  } catch {
    return {
      navigation: { status: "unavailable", reason: "command_write_failed" },
    };
  }
}

export function showAgentProject(
  context: ActionRunContext | undefined,
  projectId: string,
  intent?: "open",
) {
  return showAgentResource(context, "project", projectId, intent);
}
