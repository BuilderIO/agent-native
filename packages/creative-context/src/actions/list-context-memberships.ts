import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listContextMemberships } from "../store/index.js";

export default defineAction({
  description: "List published memberships in a governed Creative Context. Pending submissions are visible only to their submitter and reviewers.",
  schema: z.object({ contextId: z.string().min(1), status: z.enum(["active", "removed"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().optional() }),
  http: { method: "GET" }, readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: listContextMemberships,
});
