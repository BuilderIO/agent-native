import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

export const VIEWS = ["journeys", "emails", "audiences", "contacts", "accounts", "tokens", "conversions", "connections", "settings"] as const;

export default defineAction({
  description: "Agent-only: open a view in the current browser tab. Views: journeys, emails, audiences, contacts, accounts, tokens, conversions, connections, settings. Pass id to open one journey canvas, email, audience or contact; pass report: true with a journey id to open its report.",
  schema: z.object({
    view: z.enum(VIEWS).default("journeys").describe("View to open; defaults to journeys"),
    id: z.string().optional().describe("Item id (journeys, emails, audiences, contacts)"),
    report: z.boolean().optional().describe("Open the journey report instead of the canvas"),
  }),
  outputSchema: z.object({ path: z.string(), navigated: z.literal(true) }),
  http: false,
  run: async ({ view, id, report }) => {
    const path = id ? `/${view}/${encodeURIComponent(id)}${report && view === "journeys" ? "/report" : ""}` : `/${view}`;
    await writeAppStateForCurrentTab("navigate", { view, id, path, _writeId: crypto.randomUUID() });
    return { path, navigated: true as const };
  },
});
