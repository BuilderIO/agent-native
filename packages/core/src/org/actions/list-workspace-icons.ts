import { z } from "zod";

import { defineAction } from "../../action.js";
import { getDbExec } from "../../db/client.js";
import { listIconAssets } from "../../icon-assets/index.js";
import { listFederatedWorkspaceIconsForOwner } from "../../icon-assets/workspace-transport.js";
import { requireOrgMember } from "../actions.js";

export default defineAction({
  description:
    "List private workspace icons uploaded by the current organization administrator.",
  http: { method: "GET" },
  readOnly: true,
  schema: z.object({}),
  run: async (_args, ctx) => {
    const caller = await requireOrgMember(ctx, true);
    const result = await getDbExec().execute({
      sql: `SELECT identity_authority, identity_id, allowed_domain FROM organizations WHERE id = ? LIMIT 1`,
      args: [caller.orgId],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("Organization not found.");
    const authority = {
      identityAuthority:
        typeof row.identity_authority === "string"
          ? row.identity_authority
          : null,
      identityId: typeof row.identity_id === "string" ? row.identity_id : null,
      allowedDomain:
        typeof row.allowed_domain === "string" ? row.allowed_domain : null,
    };
    if (
      Boolean(authority.identityAuthority) !== Boolean(authority.identityId)
    ) {
      throw new Error("Workspace identity mapping is incomplete.");
    }
    const assets = authority.identityAuthority
      ? await listFederatedWorkspaceIconsForOwner(authority, caller.email)
      : await listIconAssets({ ownerEmail: caller.email, orgId: caller.orgId });
    return {
      assets: assets.map((asset) => ({
        id: asset.id,
        alt: asset.filename?.replace(/\.[^./\\]+$/, "") || undefined,
      })),
    };
  },
});
