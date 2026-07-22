import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

const viewSchema = z.enum([
  "work",
  "account",
  "person",
  "opportunity",
  "record",
  "tasks",
  "proposals",
  "views",
  "dashboard",
  "ask",
  "setup",
  "settings",
]);

const paths = {
  work: "/",
  account: "/accounts",
  person: "/people",
  opportunity: "/opportunities",
  tasks: "/tasks",
  proposals: "/proposals",
  views: "/views",
  dashboard: "/dashboard",
  ask: "/ask",
  setup: "/setup",
  settings: "/settings",
} as const;

export default defineAction({
  description:
    "Navigate the CRM UI to work, records, tasks, proposals, saved views, Ask CRM, setup, or settings.",
  schema: z.object({
    view: viewSchema,
    recordId: z.string().trim().min(1).max(200).optional(),
    viewId: z.string().trim().min(1).max(200).optional(),
    dashboardId: z.string().trim().min(1).max(200).optional(),
    query: z.string().trim().max(200).optional(),
    settingsSection: z.enum(["intelligence"]).optional(),
  }),
  http: false,
  run: async (args) => {
    if (args.view === "record" && !args.recordId) {
      throw new Error("recordId is required when navigating to a CRM record.");
    }
    const basePath =
      args.view === "record"
        ? `/records/${encodeURIComponent(args.recordId!)}`
        : args.view === "settings" && args.settingsSection
          ? `/settings/${args.settingsSection}`
          : paths[args.view];
    const path =
      args.view === "dashboard" && args.dashboardId
        ? `${basePath}?id=${encodeURIComponent(args.dashboardId)}`
        : basePath;
    await writeAppStateForCurrentTab("navigate", { ...args, path });
    return { navigatingTo: path };
  },
});
