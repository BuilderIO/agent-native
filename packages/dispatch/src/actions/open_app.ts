import { defineAction, embedApp } from "@agent-native/core";
import { z } from "zod";
import { openGrantedDispatchMcpApp } from "../server/lib/mcp-gateway.js";

const deepLinkParam = z.union([z.string(), z.number(), z.boolean()]);
const openAppSchema = z
  .object({
    app: z
      .string()
      .describe(
        'Granted app id, e.g. mail or calendar. Use "dispatch" for Dispatch-owned pages such as /extensions.',
      ),
    view: z.string().optional().describe("Target view in the app, e.g. inbox."),
    path: z
      .string()
      .optional()
      .describe(
        'Optional route within the target app, e.g. /adhoc/q2 or /chart?panel=... . Dispatch extension routes such as /extensions/<id>/<slug> belong to app "dispatch".',
      ),
    params: z
      .record(z.string(), deepLinkParam)
      .optional()
      .describe("Optional record-focus or filter params."),
    embed: z
      .boolean()
      .optional()
      .describe(
        "Render the app or focused route/component inline in MCP Apps when supported.",
      ),
    chrome: z
      .enum(["full", "minimal"])
      .optional()
      .describe("Embed chrome preference for compatible app routes."),
  })
  .refine((input) => input.view?.trim() || input.path?.trim(), {
    message: "open_app requires either view or path",
    path: ["view"],
  });

export default defineAction({
  description:
    'Build a deep link or embeddable app route/component route for an app available through Dispatch MCP. Use app "dispatch" for Dispatch extension/tool pages. No side effects; surface the returned Open link to the user.',
  schema: openAppSchema,
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (args) => openGrantedDispatchMcpApp(args),
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const r = result as { url?: string; app?: string; view?: string };
    if (!r.url) return null;
    return {
      url: r.url,
      label: `Open ${r.app ?? "app"}`,
      view: r.view,
    };
  },
  mcpApp: {
    resource: embedApp({
      title: "Open app",
      description: "Render the requested granted app route inline.",
      iframeTitle: "Dispatch MCP app",
      openLabel: "Open app",
      frameDomains: ["https:", "http://localhost:*", "http://127.0.0.1:*"],
      height: 900,
    }),
  },
});
