/**
 * Navigate the UI to a view.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=overview
 *   pnpm action navigate --view=dreams
 *   pnpm action navigate --view=<custom-dispatch-extension-id>
 *   pnpm action navigate --path=/some/route
 *
 * Options:
 *   --view   View name to navigate to
 *   --path   URL path to navigate to
 *   --threadId Chat thread ID to open on the chat route
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a specific view or path. Use threadId to open a specific chat thread on the chat route. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "Named dispatch view to navigate to. Built-in views include chat, overview, apps, metrics, new-app, vault, integrations, messaging, workspace, agents, destinations, identities, approvals, audit, thread-debug, dreams, and team. Generated Dispatch extension tabs can also use their nav item id.",
      ),
    path: z.string().optional().describe("URL path to navigate to"),
    threadId: z
      .string()
      .optional()
      .describe("Chat thread ID to open on the chat route"),
  }),
  http: false,
  run: async (args) => {
    const threadId = args.threadId?.trim();
    if (!args.view && !args.path && !threadId) {
      return "Error: At least --view, --path, or --threadId is required.";
    }
    const nav: Record<string, string> = {};
    // A thread id without an explicit view implies the chat surface.
    if (args.view) nav.view = args.view;
    else if (threadId) nav.view = "chat";
    if (args.path) nav.path = args.path;
    if (threadId) nav.threadId = threadId;
    await writeAppState("navigate", nav);
    return `Navigating to ${args.view || args.path || `chat thread ${threadId}`}`;
  },
});
