import { z } from "zod";

import { defineAction } from "../../../action.js";
import { embedApp } from "../../../mcp/embed-app.js";
import { buildDeepLink } from "../../../server/deep-link.js";
import { getRequestUserEmail } from "../../../server/request-context.js";
import {
  emptyContextManifest,
  type ContextManifest,
} from "../../../shared/context-xray.js";
import { callerOwnsThread } from "../../run-ownership.js";
import { readContextManifest } from "../directives-store.js";
import {
  contextXrayAuthError,
  contextXrayThreadNotFoundError,
} from "./errors.js";

function contextXrayDeepLink(threadId: string): string {
  return buildDeepLink({
    app: "agent-native",
    view: "context-xray",
    to: `/?contextXray=1&threadId=${encodeURIComponent(threadId)}`,
    params: { threadId },
  });
}

export default defineAction({
  description:
    "Get the current Context X-Ray manifest for a chat thread, including context segments, token counts, and pin/evict status.",
  schema: z.object({
    threadId: z.string().describe("Chat thread id to inspect."),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Context X-Ray",
      description: "Inspect and manage the live agent context window.",
      iframeTitle: "Context X-Ray",
      openLabel: "Open Context X-Ray",
      height: 800,
    }),
  },
  link: ({ args, result }) => {
    const threadId =
      typeof args.threadId === "string"
        ? args.threadId
        : typeof result?.threadId === "string"
          ? result.threadId
          : "";
    if (!threadId) return null;
    return {
      url: contextXrayDeepLink(threadId),
      label: "Open Context X-Ray",
      view: "context-xray",
    };
  },
  run: async (args): Promise<ContextManifest> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw contextXrayAuthError();
    const ownsThread = await callerOwnsThread(ownerEmail, args.threadId);
    if (!ownsThread) throw contextXrayThreadNotFoundError();
    const manifest =
      (await readContextManifest(args.threadId)) ??
      emptyContextManifest(args.threadId, { enforceable: true });
    return {
      ...manifest,
      url: contextXrayDeepLink(args.threadId),
      enforceable: manifest.enforceable ?? true,
      source: manifest.source ?? "structured",
    };
  },
});
