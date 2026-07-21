import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

const viewSchema = z.enum([
  "work",
  "account",
  "person",
  "opportunity",
  "record",
  "views",
  "ask",
  "setup",
  "settings",
]);

const paths = {
  work: "/",
  account: "/accounts",
  person: "/people",
  opportunity: "/opportunities",
  views: "/views",
  ask: "/ask",
  setup: "/setup",
  settings: "/settings",
} as const;

export default defineAction({
  description:
    "Navigate the CRM UI to work, accounts, people, opportunities, a record, saved views, Ask CRM, or setup.",
  schema: z.object({
    view: viewSchema,
    recordId: z.string().trim().min(1).max(200).optional(),
    viewId: z.string().trim().min(1).max(200).optional(),
    query: z.string().trim().max(200).optional(),
  }),
  http: false,
  run: async (args) => {
    if (args.view === "record" && !args.recordId) {
      throw new Error("recordId is required when navigating to a CRM record.");
    }
    const path =
      args.view === "record"
        ? `/records/${encodeURIComponent(args.recordId!)}`
        : paths[args.view];
    await writeAppStateForCurrentTab("navigate", { ...args, path });
    return { navigatingTo: path };
  },
});
