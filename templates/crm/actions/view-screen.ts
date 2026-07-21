import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

import { getCrmRecord, listCrmRecords } from "../server/db/crm-store.js";

export default defineAction({
  description:
    "Return a refreshed, access-scoped snapshot of the CRM screen the user is viewing. Basic navigation is already included in current-screen context.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = (await readAppStateForCurrentTab("navigation")) as {
      view?: "account" | "person" | "opportunity" | "record";
      recordId?: string;
      query?: string;
    } | null;
    const url = await readAppStateForCurrentTab("__url__");
    const screen: Record<string, unknown> = { navigation, url };

    if (navigation?.view === "record" && navigation.recordId) {
      screen.record = await getCrmRecord(navigation.recordId);
    } else if (
      navigation?.view === "account" ||
      navigation?.view === "person" ||
      navigation?.view === "opportunity"
    ) {
      screen.records = await listCrmRecords({
        kind: navigation.view,
        query: navigation.query,
        limit: 50,
      });
    }

    return screen;
  },
});
