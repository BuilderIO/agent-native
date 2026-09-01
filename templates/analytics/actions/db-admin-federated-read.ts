import {
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  dataTableWidgetResultSchema,
  defineAction,
} from "@agent-native/core";

import { requireDbAdminContextFromRequest } from "../server/lib/db-admin-connections";
import {
  federatedDbAdminReadSchema,
  runDbAdminFederatedRead,
} from "../server/lib/db-admin-federated-read";

export default defineAction({
  description:
    "Run one or two admin-scoped read-only SQL sources against connected app databases, optionally join the returned rows on matching column names, and return a bounded data table with source metadata and truncation. Source SQL must be a single SELECT or WITH query; writes and multi-statement inputs are rejected.",
  schema: federatedDbAdminReadSchema.refine((value) => {
    if (value.sources.length === 1) return true;
    return Boolean(value.join);
  }, "A join is required when two sources are supplied."),
  outputSchema: dataTableWidgetResultSchema,
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_TABLE_RENDERER,
    title: "Federated db admin result",
    description: "Render joined db-admin rows as a native table.",
  },
  http: { method: "POST" },
  readOnly: true,
  grounding: true,
  run: async (args, ctx) => {
    const admin = await requireDbAdminContextFromRequest(ctx);
    return runDbAdminFederatedRead(admin, args);
  },
});
