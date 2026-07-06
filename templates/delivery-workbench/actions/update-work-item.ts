import { defineAction } from "@agent-native/core";

import {
  updateWorkItem,
  updateWorkItemInputSchema,
} from "../server/lib/work-items.js";

export default defineAction({
  description:
    "Patch a delivery work item status, assignee, priority, tags, due date, title, body, or metadata. Requires editor access.",
  schema: updateWorkItemInputSchema,
  run: updateWorkItem,
});
