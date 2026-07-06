import { defineAction } from "@agent-native/core";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

function writeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default defineAction({
  description:
    "Navigate Delivery Workbench to queue, detail, or routing rules views.",
  schema: z.object({
    view: z.enum(["queue", "detail", "routing-rules"]).default("queue"),
    workItemId: z.string().optional(),
  }),
  http: false,
  run: async ({ view, workItemId }) => {
    if (view === "detail" && !workItemId) {
      throw new Error("detail navigation requires workItemId.");
    }
    const path = view === "detail" ? `/work-items/${workItemId}` : `/${view}`;
    await writeAppStateForCurrentTab("navigate", {
      view,
      workItemId,
      path,
      _writeId: writeId(),
    });
    return { view, workItemId, path };
  },
});
