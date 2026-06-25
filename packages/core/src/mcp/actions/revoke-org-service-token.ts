/**
 * Revoke an org service token by id. Owner/admin only. Uses the same
 * `revoked_at` gate as personal-token revocation, so the token stops
 * authenticating on its next request. The revoke is scoped by org id AND
 * kind='service' in SQL — a caller can never revoke another org's token or a
 * personal token through this action.
 */
import { z } from "zod";

import { defineAction } from "../../action.js";
import { revokeOrgServiceToken } from "../connect-store.js";
import { requireServiceTokenCaller } from "./service-token-access.js";

export default defineAction({
  description:
    "Revoke one of your organization's service tokens by id (get ids from list-org-service-tokens). The token stops working immediately. Org owner/admin only. Idempotent.",
  schema: z.object({
    id: z.string().min(1).describe("Service token id to revoke"),
  }),
  toolCallable: false,
  run: async (args, ctx) => {
    const caller = await requireServiceTokenCaller({
      userEmail: ctx?.userEmail,
      orgId: ctx?.orgId,
      level: "manage",
    });
    const revoked = await revokeOrgServiceToken(caller.orgId, args.id);
    return { ok: revoked };
  },
});
