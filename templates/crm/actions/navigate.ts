import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

import {
  CRM_RECORD_KINDS,
  CRM_SETTINGS_SECTIONS,
  CRM_VIEWS,
  crmNavigationPath,
} from "../shared/crm-navigation.js";

export default defineAction({
  description:
    "Navigate the CRM UI to work, the record grid, one record, lists, a saved view, a list or view board, tasks, proposals, a dashboard, Ask CRM, setup, or one settings tab.",
  schema: z.object({
    view: z.enum(CRM_VIEWS),
    recordId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Required for view=record."),
    listId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Opens that list on the /views surface. A board needs this or viewId.",
      ),
    viewId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Saved view to open. A board needs this or listId."),
    dashboardId: z.string().trim().min(1).max(200).optional(),
    kind: z
      .enum(CRM_RECORD_KINDS)
      .optional()
      .describe("Record kind tab for view=records."),
    query: z.string().trim().max(200).optional(),
    settingsSection: z.enum(CRM_SETTINGS_SECTIONS).optional(),
  }),
  http: false,
  run: async (args) => {
    const path = crmNavigationPath(args);
    await writeAppStateForCurrentTab("navigate", { ...args, path });
    return { navigatingTo: path };
  },
});
