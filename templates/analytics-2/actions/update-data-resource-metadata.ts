import { defineAction, fail } from "@agent-native/core/action";

import {
  dataResourceMetadataSchema,
  updateDataResourceMetadataSchema,
} from "../app/lib/model/data-resource-contracts.js";
import {
  currentWorkspaceCapabilities,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import {
  metadataOptions,
  withConnectionGuard,
} from "../server/model/data-connection-mutations.js";
import {
  connectionIncludedForAgent,
  organizationSourceAccess,
  readDataConnection,
} from "../server/model/data-connections.js";
import { writeDataResourceMetadata } from "../server/model/data-resource-metadata.js";
import { resourcePolicies } from "../server/model/data-resource-policy.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../shared/bigquery-source-contract.js";

export default defineAction({
  description:
    "Update only annotation fields (description, status, categories, AI usage) for one resource in a granted warehouse connection. Requires workspace management access. Provider tables and connection credentials are never touched.",
  schema: updateDataResourceMetadataSchema,
  outputSchema: dataResourceMetadataSchema,
  http: { method: "POST" },
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ connectionId, resource, patch }, context) => {
    const current = await requireCurrentWorkspace();
    const capabilities = await currentWorkspaceCapabilities(current);
    // Annotating a connection and its rows is a workspace-management action;
    // every member reads annotations. Organisation admins are covered by
    // isManagerOrAbove as well as the app's manager role.
    if (!capabilities.isManagerOrAbove) {
      fail(
        "Workspace managers and organisation admins can edit data annotations.",
        {
          statusCode: 403,
          errorCode: "data_resource_metadata_manager_required",
        },
      );
    }
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    // The policy read, annotation merge and root cascade share deletion's guard.
    // Re-read visibility and consent after acquiring it, never before the lock.
    return withConnectionGuard(scope, connectionId, async (tx) => {
      // The organisation BigQuery source is a virtual connection whose
      // annotations live under the same id; it has no workspace-connection row,
      // so its workspace credential stands in for that visibility check.
      const organizationAccess =
        connectionId === ORGANIZATION_BIGQUERY_SOURCE_ID
          ? await organizationSourceAccess()
          : null;
      const connection = organizationAccess
        ? null
        : await readDataConnection(connectionId);
      if (context?.caller !== "frontend") {
        const included = organizationAccess
          ? organizationAccess.includedForAgent
          : connection
            ? await connectionIncludedForAgent(connection)
            : false;
        if (!included)
          fail(
            "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
            {
              errorCode: "data_connection_ai_disabled",
              statusCode: 403,
            },
          );
        const policy = await resourcePolicies(
          scope,
          connectionId,
          [resource],
          "included",
          metadataOptions(tx),
        );
        if (policy.get(`${resource.kind}:${resource.id}`) !== "included") {
          fail(
            "This data resource is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
            {
              errorCode: "data_resource_ai_disabled",
              statusCode: 403,
            },
          );
        }
        // Agents may tighten a currently permitted policy, never broaden it.
        if (patch.aiUsage === "included")
          fail(
            "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
            {
              errorCode: "data_connection_ai_disabled",
              statusCode: 403,
            },
          );
      }
      return writeDataResourceMetadata(
        scope,
        connectionId,
        resource,
        patch,
        metadataOptions(tx),
      );
    });
  },
});
