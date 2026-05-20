import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { openGrantedDispatchMcpApp } from "../server/lib/mcp-gateway.js";

const deepLinkParam = z.union([z.string(), z.number(), z.boolean()]);

export default defineAction({
  description:
    "Build a deep link for an app available through Dispatch MCP. No side effects; surface the returned Open link to the user.",
  schema: z.object({
    app: z.string().describe("Granted app id, e.g. mail or calendar."),
    view: z.string().describe("Target view in the app, e.g. inbox."),
    params: z
      .record(z.string(), deepLinkParam)
      .optional()
      .describe("Optional record-focus or filter params."),
  }),
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
});
