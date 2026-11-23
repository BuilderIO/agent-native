import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  getDbtServiceTokenState,
  readDbtServiceToken,
  readOrganizationDbtConfigView,
  requireDbtUserEmail,
  requireExactDbtRequestContext,
} from "../server/lib/org-bigquery-dbt.js";
import { memberVisibleDbtConfig } from "../shared/workspace-warehouse-dbt.js";
import {
  requireBigQueryModelCurator,
  requireSemanticOrg,
} from "./_semantic-helpers.js";

/**
 * Reads the workspace dbt settings: nonsecret configuration, revision, and
 * whether a usable token is stored. Never the token itself.
 */
export default defineAction({
  description:
    "Read the workspace dbt metadata settings: the saved configuration, its revision, and whether a dbt Service token is stored. Never returns the token itself. Any active workspace member sees whether dbt is on and its version; the connection ids, token presence and the edit form require an active workspace admin or owner.",
  schema: z.object({
    forEdit: z
      .boolean()
      .optional()
      .describe(
        "Include stored-token presence for editing a disabled integration, without reading its value.",
      ),
  }),
  http: { method: "GET" },
  // Strict: no token, last4 or manifest field exists in this result.
  outputSchema: z
    .object({
      revision: z.number().int().min(0).nullable(),
      config: z
        .object({
          hasDbtMetadata: z.boolean(),
          dbtVersion: z.enum(["current", "legacy"]),
          dbtAccountId: z.string().optional(),
          dbtProjectId: z.string().optional(),
          dbtEnvironmentId: z.string().optional(),
          dbtCloudHostname: z.string().optional(),
        })
        .strict()
        .nullable(),
      dbtEnabled: z.boolean(),
      tokenConfigured: z.boolean(),
      editOrgId: z.string().min(1).optional(),
    })
    .strict(),
  readOnly: true,
  planMode: { effect: "read" },
  audit: {
    recordInputs: false,
    summary: () => "Read the workspace dbt metadata settings.",
  },
  run: async ({ forEdit }) => {
    const orgId = await requireSemanticOrg();
    const userEmail = requireDbtUserEmail();
    const active = requireExactDbtRequestContext({ orgId, userEmail });
    let curator = true;
    try {
      await requireBigQueryModelCurator(active);
    } catch (error) {
      const denied =
        error !== null &&
        typeof error === "object" &&
        "errorCode" in error &&
        error.errorCode === "semantic_model_source_admin_required";
      if (!denied || forEdit === true) throw error;
      curator = false;
    }

    const view = await readOrganizationDbtConfigView(active.orgId);
    if (!curator)
      return {
        revision: view.revision,
        config: view.config ? memberVisibleDbtConfig(view.config) : null,
        dbtEnabled: view.dbtEnabled,
        tokenConfigured: false,
      };
    // Normal disabled reads skip the vault. Editing needs presence metadata
    // so a saved token can be reused; its value stays unread while disabled.
    let tokenConfigured = false;
    if (view.dbtEnabled || forEdit === true) {
      tokenConfigured = (await getDbtServiceTokenState(active.orgId))
        .tokenConfigured;
      // Presence alone is not readiness: read the exact slot once and discard
      // the value, so an undecryptable row is 503 and a blank one is 409.
      if (view.dbtEnabled && tokenConfigured)
        await readDbtServiceToken(active.orgId);
    }

    return {
      revision: view.revision,
      config: view.config,
      dbtEnabled: view.dbtEnabled,
      tokenConfigured,
      ...(forEdit === true ? { editOrgId: active.orgId } : {}),
    };
  },
});
