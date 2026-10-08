import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { isOrgAdmin } from "../server/lib/org-admin.js";

export default defineAction({
  description:
    "Returns whether the current user can view the audit log (org admin/owner, or in single-user fallback mode). Used by the UI to show or hide the Audit nav link.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const allowed = await isOrgAdmin();
    return { allowed };
  },
});
