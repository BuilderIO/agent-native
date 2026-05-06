import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { isOrgAdmin } from "../server/lib/org-admin.js";

/**
 * UI-side admin check used to decide whether to render the sidebar Audit
 * link. Cheaper than `list-audit-runs` (just a single org_members lookup)
 * and intended to be polled by the layout. The action layer still
 * re-checks via `assertOrgAdmin()` on every audit call — the UI hint is
 * advisory, not authoritative.
 */
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
