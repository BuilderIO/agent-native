import { defineAction } from "@agent-native/core";

import {
  listWorkItems,
  listWorkItemsInputSchema,
} from "../server/lib/work-items.js";

export default defineAction({
  description:
    "List canonical delivery work items for the queue. Supports status, priority, provider, assignee, tag, search, and limit filters.",
  schema: listWorkItemsInputSchema,
  http: { method: "GET" },
  readOnly: true,
  run: listWorkItems,
});
