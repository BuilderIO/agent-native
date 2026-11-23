import { defineAction, fail } from "@agent-native/core/action";

import {
  dataResourceMetadataListSchema,
  listDataResourceMetadataSchema,
} from "../app/lib/model/data-resource-contracts.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import {
  connectionIncludedForAgent,
  organizationSourceAccess,
  readBrowsableDataConnection,
} from "../server/model/data-connections.js";
import {
  readDataResourceMetadata,
  readResourcePolicyRevision,
} from "../server/model/data-resource-metadata.js";
import { resourcePolicies } from "../server/model/data-resource-policy.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../shared/bigquery-source-contract.js";

export default defineAction({
  description:
    "Read the workspace's saved annotations (description, status, categories, AI usage) for resources inside one granted warehouse connection. Annotation fields only; no connection config or credential is returned.",
  schema: listDataResourceMetadataSchema,
  outputSchema: dataResourceMetadataListSchema,
  // Nested resource refs survive a JSON body; the GET query parser turns a
  // repeated `resources[]` into strings that the strict ref schema rejects.
  http: { method: "POST" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ connectionId, resources }, context) => {
    // The request, not an argument, decides the account and organisation.
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    // Visibility of the connection is checked before any annotation is read,
    // so an id from another workspace is a 404 and never a metadata read. The
    // organisation BigQuery source is a virtual connection synthesised from the
    // workspace credential, so it is authorised by that credential instead of a
    // workspace-connection row (its annotations live under the same id).
    const organizationSource = connectionId === ORGANIZATION_BIGQUERY_SOURCE_ID;
    const organizationAccess = organizationSource
      ? await organizationSourceAccess()
      : null;
    if (organizationAccess && !organizationAccess.configured)
      fail("The organization BigQuery connection is not configured.", {
        errorCode: "data_connection_not_connected",
        statusCode: 409,
      });
    const connection = organizationSource
      ? null
      : await readBrowsableDataConnection(connectionId);
    // A UI filter is not authorization: a direct agent call must respect the
    // same canonical connection opt-out as the catalogue and query gates.
    if (
      context?.caller !== "frontend" &&
      !(organizationAccess
        ? organizationAccess.includedForAgent
        : connection
          ? await connectionIncludedForAgent(connection)
          : false)
    ) {
      fail(
        "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
        {
          errorCode: "data_connection_ai_disabled",
          statusCode: 403,
        },
      );
    }
    const revision =
      context?.caller !== "frontend"
        ? await readResourcePolicyRevision(scope, connectionId, {
            bypassCache: true,
          })
        : 0;
    const result = await readDataResourceMetadata(
      scope,
      connectionId,
      resources,
    );
    if (context?.caller === "frontend") return result;
    const policy = await resourcePolicies(
      scope,
      connectionId,
      result.resources,
      "included",
      { bypassCache: true },
    );
    if (
      !(organizationSource
        ? (await organizationSourceAccess()).includedForAgent
        : await connectionIncludedForAgent(
            await readBrowsableDataConnection(connectionId),
            { bypassCache: true },
          ))
    )
      fail(
        "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
        {
          statusCode: 403,
          errorCode: "data_connection_ai_disabled",
        },
      );
    if (
      (await readResourcePolicyRevision(scope, connectionId, {
        bypassCache: true,
      })) !== revision
    )
      fail("The data resource policy changed. Retry the read.", {
        statusCode: 409,
        errorCode: "data_resource_policy_changed",
      });
    return {
      ...result,
      resources: result.resources.filter(
        (resource) =>
          policy.get(`${resource.kind}:${resource.id}`) === "included",
      ),
    };
  },
});
