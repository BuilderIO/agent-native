import { defineAction } from "@agent-native/core";

import {
  ingestWorkItems,
  ingestWorkItemsInputSchema,
} from "../server/lib/work-items.js";

export default defineAction({
  description:
    "Bulk ingest normalized delivery work items. This is the canonical batch write entrypoint for upstream syncs and is idempotent for the same provider/source dataset.",
  schema: ingestWorkItemsInputSchema,
  run: ingestWorkItems,
});
